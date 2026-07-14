$index = [System.IO.File]::ReadAllText("$PSScriptRoot/index.html")

$index = [regex]::Replace($index, 'b(\d+)', { param($m) "b$(([int]$m.Groups[1].Value + 1).ToString('D3'))" })

$buildNum = [regex]::Match($index, 'b(\d+)').Groups[1].Value

$sw = [System.IO.File]::ReadAllText("$PSScriptRoot/sw.js")
$sw = [regex]::Replace($sw, "(?<=weather-tool-)\w+", "b$buildNum")

[System.IO.File]::WriteAllText("$PSScriptRoot/index.html", $index)
[System.IO.File]::WriteAllText("$PSScriptRoot/sw.js", $sw)
