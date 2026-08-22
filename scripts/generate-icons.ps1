param([string]$Root = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$iconDir = Join-Path $Root 'icons'
New-Item -ItemType Directory -Force -Path $iconDir | Out-Null
foreach ($canvasSize in @(16, 32, 48, 128)) {
  $bmp = New-Object System.Drawing.Bitmap $canvasSize, $canvasSize
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::FromArgb(11, 31, 53))
  $cyan = [System.Drawing.ColorTranslator]::FromHtml('#22d3ee'); $green = [System.Drawing.ColorTranslator]::FromHtml('#22c55e')
  $lineWidth = [single]([Math]::Max(1, ([double]$canvasSize / 14)))
  $pen = [System.Drawing.Pen]::new($cyan, $lineWidth)
  $points = @(
    @(($canvasSize * .23), ($canvasSize * .57)), @(($canvasSize * .49), ($canvasSize * .28)),
    @(($canvasSize * .77), ($canvasSize * .58)), @(($canvasSize * .49), ($canvasSize * .78))
  )
  for ($i = 0; $i -lt $points.Count; $i++) { $a = $points[$i]; $b = $points[($i + 1) % $points.Count]; $g.DrawLine($pen, $a[0], $a[1], $b[0], $b[1]) }
  for ($index = 0; $index -lt $points.Count; $index++) {
    $p = $points[$index]
    $color = if ($index -eq 1) { $green } else { $cyan }
    $brush = New-Object System.Drawing.SolidBrush $color
    $r = [double]([Math]::Max(2, ([double]$canvasSize / 5)))
    $g.FillEllipse($brush, $p[0] - $r / 2, $p[1] - $r / 2, $r, $r)
    $brush.Dispose()
  }
  $bmp.Save((Join-Path $iconDir "icon-$canvasSize.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $pen.Dispose(); $g.Dispose(); $bmp.Dispose()
}
