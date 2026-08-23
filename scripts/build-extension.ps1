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
$files = @('manifest.json','app.html','app.css','app.js','alarm-view.js','settings-view.js')
foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $rootPath $file) -Destination (Join-Path $unpacked $file) }
foreach ($dir in @('background','core','icons','lib','map','offscreen')) { Copy-Item -LiteralPath (Join-Path $rootPath $dir) -Destination (Join-Path $unpacked $dir) -Recurse }
function Assert-PcmWav([string]$Path) {
  $bytes = [System.IO.File]::ReadAllBytes($Path); if ($bytes.Length -lt 44 -or [System.Text.Encoding]::ASCII.GetString($bytes, 0, 4) -ne 'RIFF' -or [System.Text.Encoding]::ASCII.GetString($bytes, 8, 4) -ne 'WAVE') { throw "Gecersiz WAV: $Path" }
  $offset = 12; $format = 0; $byteRate = 0; $dataLength = 0; while ($offset + 8 -le $bytes.Length) { $chunk = [System.Text.Encoding]::ASCII.GetString($bytes, $offset, 4); $length = [System.BitConverter]::ToInt32($bytes, $offset + 4); if ($chunk -eq 'fmt ' -and $length -ge 16) { $format = [System.BitConverter]::ToInt16($bytes, $offset + 8); $byteRate = [System.BitConverter]::ToInt32($bytes, $offset + 16) } if ($chunk -eq 'data') { $dataLength = $length; break } $offset += 8 + $length + ($length % 2) }
  $duration = if ($byteRate -gt 0) { $dataLength / $byteRate } else { 0 }; if ($format -ne 1 -or $duration -lt 5 -or $duration -gt 10) { throw "PCM WAV 5-10 sn olmali: $Path" }; return $duration
}
$soundSource = Join-Path $rootPath 'docs\WebSCADA_6_Alarm_Sesi_8sn'; $sounds = @('warning_01_pulse.wav','warning_02_double_beep.wav','warning_03_chime.wav','critical_01_dualtone.wav','critical_02_siren.wav','critical_03_triple_burst.wav')
$soundDestination = Join-Path $unpacked 'sounds\alarm'; New-Item -ItemType Directory -Force -Path $soundDestination | Out-Null
foreach ($sound in $sounds) { $source = Join-Path $soundSource $sound; if (!(Test-Path -LiteralPath $source -PathType Leaf)) { throw "Alarm ses dosyasi eksik: $source" }; Assert-PcmWav $source | Out-Null; Copy-Item -LiteralPath $source -Destination (Join-Path $soundDestination $sound) }
$iconBytes = [System.IO.File]::ReadAllBytes((Join-Path $unpacked 'icons\icon-128.png')); $pngMagic = @(137,80,78,71,13,10,26,10); if ($iconBytes.Length -lt 8 -or (@(0..7) | Where-Object { $iconBytes[$_] -ne $pngMagic[$_] }).Count) { throw 'icons/icon-128.png gecersiz PNG.' }
New-Item -ItemType Directory -Force -Path (Join-Path $unpacked 'data') | Out-Null
foreach ($file in @('kml_layers_v2.json','mapping.json','scada_auth.json')) { Copy-Item -LiteralPath (Join-Path $rootPath "data\$file") -Destination (Join-Path $unpacked "data\$file") }
function Assert-PackagedHtmlAssets([string]$HtmlPath) {
  $html = Get-Content -LiteralPath $HtmlPath -Raw
  $matches = @([regex]::Matches($html, '<script\b[^>]*\bsrc\s*=\s*["'']([^"'']+)["'']', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase))
  $matches += @([regex]::Matches($html, '<link\b[^>]*\bhref\s*=\s*["'']([^"'']+)["'']', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase))
  $basePath = Split-Path -Parent $HtmlPath
  foreach ($match in $matches) {
    $asset = ($match.Groups[1].Value -split '[?#]', 2)[0].Trim()
    if (!$asset -or $asset -match '^(?:https?:)?//' -or $asset -match '^(?:data|javascript):' -or $asset.StartsWith('#')) { continue }
    $target = Join-Path $basePath ($asset -replace '/', '\\')
    if (!(Test-Path -LiteralPath $target -PathType Leaf)) { throw "Paket eksik local HTML asset: $asset ($HtmlPath)" }
  }
}
Get-ChildItem -LiteralPath $unpacked -Filter '*.html' -Recurse -File | ForEach-Object { Assert-PackagedHtmlAssets $_.FullName }
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'; $zip = Join-Path $dist "WebSCADA_0.6.11_$stamp.zip"
Push-Location $unpacked
try { Compress-Archive -Path .\* -DestinationPath $zip -CompressionLevel Optimal } finally { Pop-Location }
$archive = [System.IO.Compression.ZipFile]::OpenRead($zip)
try {
  $entryNames = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
  $forbidden = @($entryNames | Where-Object { $_ -match '(?i)(^|/)(tests|docs|scripts|dist|node_modules)/|(^|/)[^/]*mock[^/]*$' })
  if ($entryNames -contains 'data/scada_auth.example.json' -or $forbidden.Count) { throw 'Paket sadece runtime dosyalarini icermeli; gelistirme veya mock dosyasi bulundu.' }
  foreach ($required in @('manifest.json','app.html','app.js','alarm-view.js','settings-view.js','icons/icon-128.png','offscreen/alarm-audio.html','offscreen/alarm-audio.js','data/kml_layers_v2.json','data/mapping.json','data/scada_auth.json') + ($sounds | ForEach-Object { "sounds/alarm/$_" })) { if ($entryNames -notcontains $required) { throw "Paket eksik runtime dosyasi: $required" } }
  $mockTokens = @('scadaFetchMock','MOCK_ENABLED','MOCK_DATA_PATH','btnScadaMock','data-scada-btn="mock"')
  foreach ($entry in @($archive.Entries | Where-Object { $_.FullName -match '\.(?:js|html|json)$' })) {
    $reader = [System.IO.StreamReader]::new($entry.Open())
    try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
    foreach ($token in $mockTokens) { if ($text.Contains($token)) { throw "Paket runtime mock belirteci iceriyor: $($entry.FullName)" } }
  }
} finally { $archive.Dispose() }
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
Write-Output "ZIP=$zip"; Write-Output "SHA256=$hash"
