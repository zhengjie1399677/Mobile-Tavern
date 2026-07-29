$files = Get-ChildItem -Path 'e:\modules\projects\Mobile-Tavern\src' -Recurse -Include *.ts, *.tsx
$modified = 0
foreach ($f in $files) {
    $content = Get-Content $f.FullName -Raw -Encoding UTF8
    if ($null -eq $content) { continue }
    # 注意 PowerShell 中 $1 后跟冒号会被解析为变量引用，需要用 ${1}
    $newContent = $content -replace 'catch\s*\(\s*(\w+)\s*:\s*any\s*\)', 'catch (${1}: unknown)'
    if ($content -ne $newContent) {
        [System.IO.File]::WriteAllText($f.FullName, $newContent, [System.Text.UTF8Encoding]::new($false))
        $modified++
        Write-Host "Modified: $($f.Name)"
    }
}
Write-Host "Total modified: $modified files"
