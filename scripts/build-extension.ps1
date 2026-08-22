param([string]$Root = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$rootPath = (Resolve-Path -LiteralPath $Root).Path
$authPath = Join-Path $rootPath 'data\scada_auth.json'
if (!(Test-Path -LiteralPath $authPath)) { throw 'data/scada_auth.json bulunamadi; paket olusturulmedi.' }
try { $auth = Get-Content -LiteralPath $authPath -Raw | ConvertFrom-Json } catch { throw 'data/scada_auth.json gecersiz JSON; paket olusturulmedi.' }
if (-not [bool]$auth.enabled -or [string]::IsNullOrWhiteSpace([string]$auth.baseUrl) -or [string]::IsNullOrWhiteSpace([string]$auth.username) -or [string]::IsNullOrWhiteSpace([string]$auth.password)) { throw 'data/scada_auth.json etkin ve Superset baseUrl/kullanici/parola alanlarini yerelde icermeli.' }
& (Join-Path $rootPath 'scripts\generate-icons.ps1') -Root $rootPath
$dist = Join-Path $rootPath 'dist'; $unpacked = Join-Path $dist 'chrome-extension'
if (Test-Path -LiteralPath $unpacked) { Remove-Item -LiteralPath $unpacked -Recurse -Force }
Get-ChildItem -LiteralPath $dist -Filter 'WebSCADA_*.zip' -File -ErrorAction SilentlyContinue | Remove-Item -Force
New-Item -ItemType Directory -Force -Path $unpacked | Out-Null
$files = @('manifest.json','app.html','app.css','app.js')
foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $rootPath $file) -Destination (Join-Path $unpacked $file) }
foreach ($dir in @('background','core','icons','lib','map')) { Copy-Item -LiteralPath (Join-Path $rootPath $dir) -Destination (Join-Path $unpacked $dir) -Recurse }
New-Item -ItemType Directory -Force -Path (Join-Path $unpacked 'data') | Out-Null
foreach ($file in @('kml_layers_v2.json','mapping.json','scada_auth.json')) { Copy-Item -LiteralPath (Join-Path $rootPath "data\$file") -Destination (Join-Path $unpacked "data\$file") }
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'; $zip = Join-Path $dist "WebSCADA_0.2.0_$stamp.zip"
Push-Location $unpacked
try { Compress-Archive -Path .\* -DestinationPath $zip -CompressionLevel Optimal } finally { Pop-Location }
$archive = [System.IO.Compression.ZipFile]::OpenRead($zip)
try {
  $entryNames = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
  $forbidden = @($entryNames | Where-Object { $_ -match '(^|/)(tests|docs|scripts|dist|node_modules)/|(^|/)mock_scada\.json$' })
  if ($entryNames -contains 'data/scada_auth.example.json' -or $forbidden.Count) { throw 'Paket sadece runtime dosyalarini icermeli; gelistirme dosyasi bulundu.' }
  foreach ($required in @('manifest.json','app.html','app.js','data/kml_layers_v2.json','data/mapping.json','data/scada_auth.json')) { if ($entryNames -notcontains $required) { throw "Paket eksik runtime dosyasi: $required" } }
} finally { $archive.Dispose() }
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
Write-Output "ZIP=$zip"; Write-Output "SHA256=$hash"
