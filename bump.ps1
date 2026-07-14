$index = [System.IO.File]::ReadAllText("$PSScriptRoot/index.html")
$sw = [System.IO.File]::ReadAllText("$PSScriptRoot/sw.js")

$index = [regex]::Replace($index, 'b(\d+)', { param($m) "b$(([int]$m.Groups[1].Value + 1).ToString('D3'))" })
$sw = [regex]::Replace($sw, 'weather-tool-v(\d+)', { param($m) "weather-tool-v$([int]$m.Groups[1].Value + 1)" })

[System.IO.File]::WriteAllText("$PSScriptRoot/index.html", $index)
[System.IO.File]::WriteAllText("$PSScriptRoot/sw.js", $sw)
