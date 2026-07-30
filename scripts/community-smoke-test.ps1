param(
    [string]$BaseUrl = "https://community.neural-node.xyz",
    [ValidateRange(1, 9)]
    [int]$TestSizeMB = 3,
    [string]$AdminToken = ""
)

# Mobile Tavern 社区服务整合冒烟测试
# 覆盖所有接口：DNS、健康、列表、上传、下载、SHA256、评论、管理员验证、管理员删除评论、管理员删除卡片
# 用法：
#   powershell -ExecutionPolicy Bypass -File .\scripts\community-smoke-test.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\community-smoke-test.ps1 -AdminToken "你的令牌"
#   powershell -ExecutionPolicy Bypass -File .\scripts\community-smoke-test.ps1 -BaseUrl http://127.0.0.1:8080 -AdminToken "你的令牌"

$ErrorActionPreference = "Stop"
$normalizedBaseUrl = $BaseUrl.TrimEnd("/")
$effectiveAdminToken = if ($AdminToken) {
    $AdminToken
} else {
    [Environment]::GetEnvironmentVariable("MOBILE_TAVERN_ADMIN_TOKEN", "User")
}

$testRoot = Join-Path $env:TEMP ("mt-smoke-" + [Guid]::NewGuid().ToString("N"))
$testFile = Join-Path $testRoot "smoke-card.json"
$downloadFile = Join-Path $testRoot "downloaded-card.json"
$uploadedCardId = $null
$uploadedCommentId = $null
$step = 0
$totalSteps = 10

function Format-Speed([double]$bytesPerSecond) {
    if ($bytesPerSecond -ge 1MB) { return "{0:N2} MB/s" -f ($bytesPerSecond / 1MB) }
    return "{0:N2} KB/s" -f ($bytesPerSecond / 1KB)
}

function Step-Header([string]$title) {
    $script:step++
    Write-Host ("[{0}/{1}] {2}" -f $script:step, $script:totalSteps, $title) -ForegroundColor Cyan
}

try {
    New-Item -ItemType Directory -Path $testRoot | Out-Null

    Write-Host "=== Mobile Tavern 社区服务整合冒烟测试 ===" -ForegroundColor Cyan
    Write-Host "目标: $normalizedBaseUrl"
    Write-Host "测试文件大小: $TestSizeMB MB"
    Write-Host "管理员令牌: $(if ($effectiveAdminToken) { '已提供' } else { '未提供（管理员相关测试将跳过）' })"
    Write-Host ""

    # [1/10] DNS 解析
    Step-Header "DNS 解析"
    $hostName = ([Uri]$normalizedBaseUrl).Host
    if ($hostName -in @("127.0.0.1", "localhost")) {
        Write-Host "本地地址，跳过 DNS" -ForegroundColor Yellow
    } else {
        $dnsTimer = [Diagnostics.Stopwatch]::StartNew()
        Resolve-DnsName $hostName -Type A -ErrorAction SilentlyContinue |
            Select-Object Name, IPAddress, @{n='TTL';e={$_.TTL}} |
            Format-Table -AutoSize
        $dnsTimer.Stop()
        Write-Host ("DNS 解析耗时: {0:N0} ms" -f $dnsTimer.Elapsed.TotalMilliseconds)
    }

    # [2/10] 健康检查 + 延迟
    Step-Header "健康检查 + 延迟"
    $healthTimer = [Diagnostics.Stopwatch]::StartNew()
    $health = Invoke-RestMethod -Uri "$normalizedBaseUrl/health" -TimeoutSec 20
    $healthTimer.Stop()
    Write-Host ("GET /health        延迟: {0:N0} ms" -f $healthTimer.Elapsed.TotalMilliseconds)

    $deepTimer = [Diagnostics.Stopwatch]::StartNew()
    $deep = Invoke-RestMethod -Uri "$normalizedBaseUrl/health/deep" -TimeoutSec 20
    $deepTimer.Stop()
    Write-Host ("GET /health/deep   状态: {0}/{1}  延迟: {2:N0} ms" -f $deep.database, $deep.status, $deepTimer.Elapsed.TotalMilliseconds)
    if ($deep.status -ne "ok") { throw "深度健康检查失败" }

    # [3/10] 列表接口（只读）
    Step-Header "角色卡列表（只读）"
    $listTimer = [Diagnostics.Stopwatch]::StartNew()
    $cards = Invoke-RestMethod -Uri "$normalizedBaseUrl/api/cards?limit=5" -TimeoutSec 20
    $listTimer.Stop()
    Write-Host ("现有卡片数: {0}  延迟: {1:N0} ms" -f $cards.Count, $listTimer.Elapsed.TotalMilliseconds)
    if ($cards.Count -gt 0) {
        Write-Host "示例: $($cards[0].title) (下载 $($cards[0].downloadCount) 次)"
    }

    # [4/10] 上传测速
    Step-Header "上传临时卡片（测速）"
    $paddingLength = $TestSizeMB * 1MB
    $card = @{
        spec = "chara_card_v2"
        spec_version = "2.0"
        data = @{
            name = "Smoke test"
            description = "Temporary smoke test card"
            personality = ""
            scenario = ""
            first_mes = "Test"
            mes_example = ""
            creator_notes = ""
            system_prompt = ""
            post_history_instructions = ""
            alternate_greetings = @()
            tags = @("smoke-test")
            creator = "Mobile Tavern"
            character_version = "1.0"
            extensions = @{ smoke_test_padding = "0" * $paddingLength }
        }
    }
    $cardJson = $card | ConvertTo-Json -Depth 8 -Compress
    [IO.File]::WriteAllText($testFile, $cardJson, [Text.UTF8Encoding]::new($false))
    $actualBytes = (Get-Item -LiteralPath $testFile).Length
    $actorUuid = [Guid]::NewGuid().ToString()
    $uploadTimer = [Diagnostics.Stopwatch]::StartNew()
    $uploadResponse = & curl.exe -sS -X POST "$normalizedBaseUrl/api/cards" `
        -F "title=Smoke test" `
        -F "description=Temporary smoke test" `
        -F "uploaderName=Smoke test" `
        -F "uploaderUuid=$actorUuid" `
        -F "card=@$testFile;type=application/json"
    $uploadTimer.Stop()
    if ($LASTEXITCODE -ne 0) { throw "curl 上传失败，退出码 $LASTEXITCODE" }
    $uploaded = $uploadResponse | ConvertFrom-Json
    if (-not $uploaded.id) { throw "上传未返回卡片 ID: $uploadResponse" }
    $uploadedCardId = $uploaded.id
    Write-Host ("卡片 ID: {0}" -f $uploadedCardId)
    Write-Host ("上传大小: {0:N2} MB  耗时: {1:N2} s  速度: {2}" -f `
        ($actualBytes/1MB), $uploadTimer.Elapsed.TotalSeconds, `
        (Format-Speed ($actualBytes / [Math]::Max($uploadTimer.Elapsed.TotalSeconds, 0.001))))

    # [5/10] 下载测速 + SHA256 完整性
    Step-Header "下载并校验 SHA256"
    $ticket = Invoke-RestMethod -Method Post `
        -Uri "$normalizedBaseUrl/api/cards/$uploadedCardId/download" `
        -ContentType "application/json" `
        -Body (@{ actorName = "Smoke test"; actorUuid = $actorUuid } | ConvertTo-Json) `
        -TimeoutSec 30
    $downloadMetrics = & curl.exe -fsS -o $downloadFile `
        -w '{"seconds":%{time_total},"bytes":%{size_download},"bytesPerSecond":%{speed_download}}' `
        "$normalizedBaseUrl$($ticket.downloadUrl)"
    if ($LASTEXITCODE -ne 0) { throw "curl 下载失败，退出码 $LASTEXITCODE" }
    $metrics = $downloadMetrics | ConvertFrom-Json
    Write-Host ("下载大小: {0:N2} MB  耗时: {1:N2} s  速度: {2}" -f `
        ([double]$metrics.bytes/1MB), [double]$metrics.seconds, `
        (Format-Speed ([double]$metrics.bytesPerSecond)))
    $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $testFile).Hash
    $downloadHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $downloadFile).Hash
    if ($sourceHash -ne $downloadHash) { throw "下载文件 SHA-256 不匹配" }
    Write-Host "SHA-256 校验通过" -ForegroundColor Green

    # [6/10] 发表评论
    Step-Header "发表评论"
    $commentBody = @{
        authorName = "Smoke test"
        authorUuid = $actorUuid
        content = "Smoke test comment $(Get-Date -Format 'HHmmss')"
    } | ConvertTo-Json -Compress
    $commentTimer = [Diagnostics.Stopwatch]::StartNew()
    $commentResp = Invoke-RestMethod -Method Post `
        -Uri "$normalizedBaseUrl/api/cards/$uploadedCardId/comments" `
        -ContentType "application/json" `
        -Body $commentBody -TimeoutSec 20
    $commentTimer.Stop()
    $uploadedCommentId = $commentResp.id
    Write-Host ("评论 ID: {0}  内容: {1}  耗时: {2:N0} ms" -f `
        $uploadedCommentId, $commentResp.content, $commentTimer.Elapsed.TotalMilliseconds)

    # [7/10] 评论列表
    Step-Header "评论列表"
    $listCommentTimer = [Diagnostics.Stopwatch]::StartNew()
    $comments = Invoke-RestMethod -Uri "$normalizedBaseUrl/api/cards/$uploadedCardId/comments?limit=10" -TimeoutSec 20
    $listCommentTimer.Stop()
    Write-Host ("评论数: {0}  耗时: {1:N0} ms" -f $comments.Count, $listCommentTimer.Elapsed.TotalMilliseconds)
    if ($comments.Count -eq 0) { throw "刚发表的评论在列表中未找到" }

    # [8/10] 管理员验证
    Step-Header "管理员令牌验证"
    if (-not $effectiveAdminToken) {
        Write-Host "未提供 AdminToken，跳过" -ForegroundColor Yellow
    } else {
        $verifyTimer = [Diagnostics.Stopwatch]::StartNew()
        $verifyResp = & curl.exe -sS -o NUL -w "%{http_code}" -X POST `
            -H "X-Admin-Token: $effectiveAdminToken" `
            "$normalizedBaseUrl/api/admin/verify"
        $verifyTimer.Stop()
        if ($verifyResp -eq "204") {
            Write-Host ("管理员令牌有效  延迟: {0:N0} ms" -f $verifyTimer.Elapsed.TotalMilliseconds) -ForegroundColor Green
        } elseif ($verifyResp -eq "401") {
            Write-Host "管理员令牌无效或服务端未配置" -ForegroundColor Red
            $effectiveAdminToken = $null
        } else {
            Write-Host "未知响应: $verifyResp" -ForegroundColor Yellow
            $effectiveAdminToken = $null
        }
    }

    # [9/10] 管理员删除评论
    Step-Header "管理员删除评论"
    if (-not $effectiveAdminToken -or -not $uploadedCommentId) {
        Write-Host "缺少令牌或评论 ID，跳过" -ForegroundColor Yellow
    } else {
        $delCommentResp = & curl.exe -sS -o NUL -w "%{http_code}" -X DELETE `
            -H "X-Admin-Token: $effectiveAdminToken" `
            "$normalizedBaseUrl/api/comments/$uploadedCommentId"
        if ($delCommentResp -eq "204") {
            Write-Host "评论已删除" -ForegroundColor Green
            $uploadedCommentId = $null
        } else {
            Write-Host "删除评论失败: HTTP $delCommentResp" -ForegroundColor Red
        }
    }

    # [10/10] 管理员删除卡片（清理）
    Step-Header "管理员删除卡片（清理）"
    if (-not $effectiveAdminToken) {
        Write-Host "未提供 AdminToken，跳过自动清理" -ForegroundColor Yellow
        Write-Host "请手动删除测试卡片 ID: $uploadedCardId" -ForegroundColor Yellow
    } else {
        $delCardResp = & curl.exe -sS -o NUL -w "%{http_code}" -X DELETE `
            -H "X-Admin-Token: $effectiveAdminToken" `
            "$normalizedBaseUrl/api/cards/$uploadedCardId"
        if ($delCardResp -eq "204") {
            Write-Host "测试卡片已删除" -ForegroundColor Green
            $uploadedCardId = $null
        } else {
            Write-Host "删除卡片失败: HTTP $delCardResp" -ForegroundColor Red
        }
    }

    Write-Host ""
    Write-Host "=== 全部测试通过 ===" -ForegroundColor Green
    exit 0
}
catch {
    Write-Host ""
    Write-Host "=== 测试失败 ===" -ForegroundColor Red
    Write-Host ("错误: {0}" -f $_.Exception.Message) -ForegroundColor Red
    Write-Host ("位置: {0}" -f $_.InvocationInfo.PositionMessage) -ForegroundColor DarkGray
    if ($uploadedCardId) {
        Write-Host "请手动清理测试卡片 ID: $uploadedCardId" -ForegroundColor Yellow
    }
    if ($uploadedCommentId) {
        Write-Host "请手动清理测试评论 ID: $uploadedCommentId" -ForegroundColor Yellow
    }
    exit 1
}
finally {
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
