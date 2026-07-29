param(
    [string]$BaseUrl = "https://community.neural-node.xyz",
    [ValidateRange(1, 9)]
    [int]$TestSizeMB = 5,
    [string]$AdminToken = ""
)

$ErrorActionPreference = "Stop"
$normalizedBaseUrl = $BaseUrl.TrimEnd("/")
$effectiveAdminToken = if ($AdminToken) {
    $AdminToken
}
else {
    [Environment]::GetEnvironmentVariable("MOBILE_TAVERN_ADMIN_TOKEN", "User")
}
$testRoot = Join-Path $env:TEMP ("mobile-tavern-speed-test-" + [Guid]::NewGuid().ToString("N"))
$testFile = Join-Path $testRoot "community-speed-test.json"
$downloadFile = Join-Path $testRoot "downloaded-card.json"
$uploadedCardId = $null

function Format-Speed([double]$bytesPerSecond) {
    if ($bytesPerSecond -ge 1MB) {
        return "{0:N2} MB/s" -f ($bytesPerSecond / 1MB)
    }
    return "{0:N2} KB/s" -f ($bytesPerSecond / 1KB)
}

try {
    New-Item -ItemType Directory -Path $testRoot | Out-Null

    Write-Host "== Mobile Tavern community speed test ==" -ForegroundColor Cyan
    Write-Host "Target: $normalizedBaseUrl"
    Write-Host "Test file: $TestSizeMB MB"
    Write-Host ""

    Write-Host "[1/5] DNS lookup"
    $hostName = ([Uri]$normalizedBaseUrl).Host
    Resolve-DnsName $hostName -Type A |
        Select-Object Name, IPAddress |
        Format-Table -AutoSize

    Write-Host "[2/5] Health-check latency"
    $healthTimer = [Diagnostics.Stopwatch]::StartNew()
    $health = Invoke-RestMethod -Uri "$normalizedBaseUrl/health/deep" -TimeoutSec 20
    $healthTimer.Stop()
    Write-Host ("Status: {0}; latency: {1:N0} ms" -f $health.status, $healthTimer.Elapsed.TotalMilliseconds)

    Write-Host "[3/5] Generate and upload a temporary card"
    $paddingLength = $TestSizeMB * 1MB
    $card = @{
        spec = "chara_card_v2"
        spec_version = "2.0"
        data = @{
            name = "Community speed test"
            description = "Temporary network speed test file"
            personality = ""
            scenario = ""
            first_mes = "Test"
            mes_example = ""
            creator_notes = ""
            system_prompt = ""
            post_history_instructions = ""
            alternate_greetings = @()
            tags = @("speed-test")
            creator = "Mobile Tavern"
            character_version = "1.0"
            extensions = @{ speed_test_padding = "0" * $paddingLength }
        }
    }
    $cardJson = $card | ConvertTo-Json -Depth 8 -Compress
    [IO.File]::WriteAllText($testFile, $cardJson, [Text.UTF8Encoding]::new($false))
    $actualBytes = (Get-Item -LiteralPath $testFile).Length
    $actorUuid = [Guid]::NewGuid().ToString()
    $uploadTimer = [Diagnostics.Stopwatch]::StartNew()
    $uploadResponse = & curl.exe -sS -X POST "$normalizedBaseUrl/api/cards" `
        -F "title=Community speed test" `
        -F "description=Temporary direct-connection speed test" `
        -F "uploaderName=Local speed test" `
        -F "uploaderUuid=$actorUuid" `
        -F "card=@$testFile;type=application/json"
    $uploadTimer.Stop()
    if ($LASTEXITCODE -ne 0) {
        throw "curl upload failed with exit code $LASTEXITCODE"
    }
    $uploaded = $uploadResponse | ConvertFrom-Json
    if (-not $uploaded.id) {
        throw "The upload endpoint did not return a card ID: $uploadResponse"
    }
    $uploadedCardId = $uploaded.id
    Write-Host ("Upload: {0}; elapsed: {1:N2} s; average: {2}" -f `
        $uploadedCardId, $uploadTimer.Elapsed.TotalSeconds, `
        (Format-Speed ($actualBytes / [Math]::Max($uploadTimer.Elapsed.TotalSeconds, 0.001))))

    Write-Host "[4/5] Register and download the temporary card"
    $ticket = Invoke-RestMethod `
        -Method Post `
        -Uri "$normalizedBaseUrl/api/cards/$uploadedCardId/download" `
        -ContentType "application/json" `
        -Body (@{ actorName = "Local speed test"; actorUuid = $actorUuid } | ConvertTo-Json)
    $downloadMetrics = & curl.exe -fsS `
        -o $downloadFile `
        -w '{"seconds":%{time_total},"bytes":%{size_download},"bytesPerSecond":%{speed_download}}' `
        "$normalizedBaseUrl$($ticket.downloadUrl)"
    if ($LASTEXITCODE -ne 0) {
        throw "curl download failed with exit code $LASTEXITCODE"
    }
    $metrics = $downloadMetrics | ConvertFrom-Json
    Write-Host ("Download: {0:N2} s; average: {1}" -f `
        [double]$metrics.seconds, (Format-Speed ([double]$metrics.bytesPerSecond)))

    Write-Host "[5/5] Integrity check"
    $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $testFile).Hash
    $downloadHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $downloadFile).Hash
    if ($sourceHash -ne $downloadHash) {
        throw "Downloaded file SHA-256 does not match"
    }
    Write-Host "SHA-256 matches. Upload and download are intact." -ForegroundColor Green
}
finally {
    if ($uploadedCardId) {
        if ($effectiveAdminToken) {
            try {
                & curl.exe -fsS -X DELETE `
                    -H "X-Admin-Token: $effectiveAdminToken" `
                    "$normalizedBaseUrl/api/cards/$uploadedCardId" | Out-Null
                Write-Host "The temporary server card was deleted."
            }
            catch {
                Write-Warning "Automatic card deletion failed: $($_.Exception.Message)"
            }
        }
        else {
            Write-Warning "AdminToken was not provided. Delete temporary card ID manually: $uploadedCardId"
        }
    }
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
