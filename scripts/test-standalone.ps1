param([string]$Root = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$rootPath = (Resolve-Path -LiteralPath $Root).Path
$temp = Join-Path ([System.IO.Path]::GetTempPath()) ("WebSCADA-standalone-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $temp | Out-Null
try {
  Get-ChildItem -LiteralPath $rootPath -Force | Where-Object { $_.Name -notin @('dist', 'build', 'node_modules') } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $temp $_.Name) -Recurse -Force }
  Push-Location $temp
  & npm.cmd test; if ($LASTEXITCODE -ne 0) { throw 'Standalone test basarisiz.' }
  & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw 'Standalone build basarisiz.' }
  $packed = Join-Path $temp 'dist\chrome-extension'
  if (!(Test-Path -LiteralPath (Join-Path $packed 'data\scada_auth.json'))) { throw 'Standalone ZIP girdisinde auth dosyasi yok.' }
  if (Test-Path -LiteralPath (Join-Path $packed 'data\scada_auth.example.json')) { throw 'Example auth dosyasi pakete sizdi.' }
  Write-Output "Standalone PASS: $temp"
} finally { Pop-Location -ErrorAction SilentlyContinue; if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force } }
