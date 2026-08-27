param(
  [string]$PackageId = "com.aitavern.app",
  [int]$Runs = 3,
  [string]$AdbPath = ""
)

$ErrorActionPreference = "Stop"

function Read-MatchedInteger {
  param(
    [string]$Text,
    [string]$Pattern
  )

  $match = [regex]::Match($Text, $Pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  if (-not $match.Success) { return $null }
  return [int](($match.Groups[1].Value -replace ",", "").Trim())
}

function Read-GfxSummary {
  param([string]$Text)

  return [ordered]@{
    totalFrames = Read-MatchedInteger $Text "Total frames rendered:\s*([\d,]+)"
    jankyFrames = Read-MatchedInteger $Text "Janky frames:\s*([\d,]+)"
    frozenFrames = Read-MatchedInteger $Text "Number Frozen Frames:\s*([\d,]+)"
    highInputLatencyFrames = Read-MatchedInteger $Text "Number High input latency:\s*([\d,]+)"
    slowUiThreadFrames = Read-MatchedInteger $Text "Number Slow UI thread:\s*([\d,]+)"
    slowBitmapUploadFrames = Read-MatchedInteger $Text "Number Slow bitmap uploads:\s*([\d,]+)"
    slowDrawFrames = Read-MatchedInteger $Text "Number Slow issue draw commands:\s*([\d,]+)"
  }
}

function Read-TotalPssKb {
  param([string]$Text)

  $totalLine = ($Text -split "`r?`n" | Where-Object { $_ -match "^\s*TOTAL\s+\d+" } | Select-Object -First 1)
  if (-not $totalLine) { return $null }
  return Read-MatchedInteger $totalLine "^\s*TOTAL\s+([\d,]+)"
}

if ($Runs -lt 1) {
  throw "Runs 必须至少为 1。"
}

$adbFromPath = Get-Command adb -ErrorAction SilentlyContinue
$adbCandidates = @(
  if ($AdbPath) { $AdbPath }
  if ($adbFromPath) { $adbFromPath.Source }
  if ($env:ANDROID_HOME) { Join-Path $env:ANDROID_HOME "platform-tools\adb.exe" }
  if ($env:ANDROID_SDK_ROOT) { Join-Path $env:ANDROID_SDK_ROOT "platform-tools\adb.exe" }
  if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe" }
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique
$resolvedAdbPath = $adbCandidates | Select-Object -First 1
if (-not $resolvedAdbPath) {
  throw "未找到 adb。请通过 -AdbPath 指定 adb.exe，配置 ANDROID_HOME / ANDROID_SDK_ROOT，或把 platform-tools 加入 PATH。"
}

$deviceLines = & $resolvedAdbPath devices | Select-Object -Skip 1 | Where-Object { $_ -match "\S" }
$authorizedDevices = @($deviceLines | Where-Object { $_ -match "\sdevice$" })
if ($authorizedDevices.Count -ne 1) {
  throw "需要且只能连接一台已授权 Android 设备；当前已授权设备数：$($authorizedDevices.Count)。"
}
$deviceSerial = (($authorizedDevices[0] -split "\s+")[0]).Trim()

function Invoke-DeviceAdb {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

  $output = & $resolvedAdbPath -s $deviceSerial @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "adb 命令执行失败：adb -s $deviceSerial $($Arguments -join ' ')"
  }
  return $output
}

$packagePath = (Invoke-DeviceAdb shell pm path $PackageId) -join "`n"
if (-not $packagePath.Contains("package:")) {
  throw "设备上未安装 $PackageId。请先安装待验收 APK。"
}

$reportDirectory = Join-Path $PSScriptRoot "..\tmp\android-ui-performance"
New-Item -ItemType Directory -Force -Path $reportDirectory | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$reportPath = Join-Path $reportDirectory "android-ui-$timestamp.json"

$deviceModel = ((Invoke-DeviceAdb shell getprop ro.product.model) -join "`n").Trim()
$androidVersion = ((Invoke-DeviceAdb shell getprop ro.build.version.release) -join "`n").Trim()
$sdkLevel = ((Invoke-DeviceAdb shell getprop ro.build.version.sdk) -join "`n").Trim()
$webViewUpdateDump = (Invoke-DeviceAdb shell dumpsys webviewupdate) -join "`n"
$webViewPackageMatch = [regex]::Match(
  $webViewUpdateDump,
  "Current WebView package.*?\(([^,\s]+),\s*([^\)]+)\)",
  [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
)
$webViewPackage = if ($webViewPackageMatch.Success) { $webViewPackageMatch.Groups[1].Value.Trim() } else { "unknown" }
$webViewVersion = if ($webViewPackageMatch.Success) { $webViewPackageMatch.Groups[2].Value.Trim() } else { "unknown" }

$launches = @()
for ($run = 1; $run -le $Runs; $run++) {
  Invoke-DeviceAdb shell am force-stop $PackageId | Out-Null
  $launchOutput = (Invoke-DeviceAdb shell am start -W -n "$PackageId/.MainActivity") -join "`n"
  Start-Sleep -Milliseconds 500

  $processId = ((Invoke-DeviceAdb shell pidof $PackageId) -join "`n").Trim()
  $gfxInfoForRun = (Invoke-DeviceAdb shell dumpsys gfxinfo $PackageId) -join "`n"
  $memoryInfoForRun = (Invoke-DeviceAdb shell dumpsys meminfo $PackageId) -join "`n"
  $launches += [ordered]@{
    run = $run
    status = ([regex]::Match($launchOutput, "Status:\s*(\S+)").Groups[1].Value)
    totalTimeMs = Read-MatchedInteger $launchOutput "TotalTime:\s*([\d,]+)"
    waitTimeMs = Read-MatchedInteger $launchOutput "WaitTime:\s*([\d,]+)"
    processAlive = -not [string]::IsNullOrWhiteSpace($processId)
    processId = $processId
    totalPssKb = Read-TotalPssKb $memoryInfoForRun
    gfx = Read-GfxSummary $gfxInfoForRun
  }
}

# 验证从后台回到前台后 Activity 与 WebView 所在进程仍然存活。
Invoke-DeviceAdb shell input keyevent KEYCODE_HOME | Out-Null
Start-Sleep -Milliseconds 500
$resumeOutput = (Invoke-DeviceAdb shell am start -W -n "$PackageId/.MainActivity") -join "`n"
Start-Sleep -Milliseconds 500
$resumeProcessId = ((Invoke-DeviceAdb shell pidof $PackageId) -join "`n").Trim()
$resumeCheck = [ordered]@{
  status = ([regex]::Match($resumeOutput, "Status:\s*(\S+)").Groups[1].Value)
  totalTimeMs = Read-MatchedInteger $resumeOutput "TotalTime:\s*([\d,]+)"
  waitTimeMs = Read-MatchedInteger $resumeOutput "WaitTime:\s*([\d,]+)"
  processAlive = -not [string]::IsNullOrWhiteSpace($resumeProcessId)
  processId = $resumeProcessId
}

$gfxInfo = (Invoke-DeviceAdb shell dumpsys gfxinfo $PackageId) -join "`n"
$memoryInfo = (Invoke-DeviceAdb shell dumpsys meminfo $PackageId) -join "`n"
$activityInfo = (Invoke-DeviceAdb shell dumpsys activity activities) -join "`n"

$report = [ordered]@{
  schemaVersion = 2
  collectedAt = (Get-Date).ToString("o")
  device = [ordered]@{
    serial = $deviceSerial
    model = $deviceModel
    androidVersion = $androidVersion
    sdkLevel = $sdkLevel
    webViewPackage = $webViewPackage
    webViewVersion = $webViewVersion
  }
  packageId = $PackageId
  launches = $launches
  resume = $resumeCheck
  final = [ordered]@{
    totalPssKb = Read-TotalPssKb $memoryInfo
    gfx = Read-GfxSummary $gfxInfo
  }
  raw = [ordered]@{
    gfxInfo = $gfxInfo
    memoryInfo = $memoryInfo
    activityInfo = $activityInfo
  }
}

$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding UTF8
Write-Host "Android UI 性能报告已生成：$reportPath"
