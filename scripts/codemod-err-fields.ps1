$ErrorActionPreference = 'Stop'
$root = 'e:\modules\projects\Mobile-Tavern\src'
$files = Get-ChildItem -Path $root -Recurse -Include *.ts, *.tsx
$modified = 0

foreach ($f in $files) {
    $content = [System.IO.File]::ReadAllText($f.FullName)
    if ($null -eq $content) { continue }

    $catchPattern = 'catch\s*\(\s*(\w+)\s*:\s*unknown\s*\)\s*\{'
    $matches = [regex]::Matches($content, $catchPattern)
    if ($matches.Count -eq 0) { continue }

    $varNames = @()
    $sb = [System.Text.StringBuilder]::new($content)

    foreach ($m in ($matches | Sort-Object { $_.Index } -Descending)) {
        $varName = $m.Groups[1].Value
        $braceStart = $m.Index + $m.Length - 1
        $depth = 0
        $endIdx = -1
        for ($i = $braceStart; $i -lt $content.Length; $i++) {
            $ch = $content[$i]
            if ($ch -eq '{') { $depth++ }
            elseif ($ch -eq '}') {
                $depth--
                if ($depth -eq 0) { $endIdx = $i; break }
            }
        }
        if ($endIdx -lt 0) { continue }

        $bodyStart = $braceStart + 1
        $bodyLen = $endIdx - $bodyStart
        $body = $sb.ToString($bodyStart, $bodyLen)

        $escapedVar = [regex]::Escape($varName)
        $msgPattern = "(?<![\w$])$escapedVar\.message(?![\w])"
        $namePattern = "(?<![\w$])$escapedVar\.name(?![\w])"
        $newBody = [regex]::Replace($body, $msgPattern, "getErrorMessage($varName)")
        $newBody = [regex]::Replace($newBody, $namePattern, "getErrorName($varName)")

        if ($newBody -ne $body) {
            $sb.Remove($bodyStart, $bodyLen) | Out-Null
            $sb.Insert($bodyStart, $newBody) | Out-Null
            if ($varNames -notcontains $varName) { $varNames += $varName }
        }
    }

    if ($varNames.Count -eq 0) { continue }

    $newContent = $sb.ToString()

    # 计算 import 路径前缀
    $relPath = $f.FullName.Substring($root.Length).TrimStart('\', '/').Replace('\', '/')
    $depth = ($relPath -split '/').Count - 1
    if ($depth -le 0) {
        $prefix = './'
    } else {
        $prefix = ('../' * $depth)
    }
    $importPath = $prefix + 'utils/errorUtils'

    if ($newContent -notmatch [regex]::Escape($importPath)) {
        $importMatches = [regex]::Matches($newContent, '(?m)^import\s+.*?;\s*$')
        if ($importMatches.Count -gt 0) {
            $lastImport = $importMatches[$importMatches.Count - 1]
            $insertPos = $lastImport.Index + $lastImport.Length
            $importLine = "`r`nimport { getErrorMessage, getErrorName } from '$importPath';"
            $newContent = $newContent.Insert($insertPos, $importLine)
        }
    }

    [System.IO.File]::WriteAllText($f.FullName, $newContent, [System.Text.UTF8Encoding]::new($false))
    $modified++
    Write-Host "Modified: $($f.Name)"
}

Write-Host "Total modified: $modified files"
