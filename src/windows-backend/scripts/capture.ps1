. "$PSScriptRoot\_io.ps1"; . "$PSScriptRoot\_win32.ps1"; . "$PSScriptRoot\_state.ps1"
function Get-Thumbprint($bmp) {
  $t = New-Object System.Drawing.Bitmap(8, 8)
  $g = [System.Drawing.Graphics]::FromImage($t)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::Low
  $g.DrawImage($bmp, 0, 0, 8, 8); $g.Dispose()
  $bytes = New-Object byte[] 64
  for ($i = 0; $i -lt 8; $i++) { for ($j = 0; $j -lt 8; $j++) {
    $c = $t.GetPixel($j, $i)
    $bytes[$i * 8 + $j] = [byte][Math]::Round(0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B)
  } }
  $t.Dispose()
  [Convert]::ToBase64String($bytes)
}
try {
  [void][W]::SetProcessDPIAware()
  $req = Read-McpRequest
  $state = Get-UiState
  $vs = $state.virtual_screen
  $x = [int]$vs.x; $y = [int]$vs.y; $w = [int]$vs.w; $h = [int]$vs.h
  $t = $req.target
  if ($t -is [string]) {
    if ($t -ne "screen") { Fail "INVALID_ARGUMENT" "string target must be 'screen'" }
  } elseif ($null -ne $t.monitor) {
    if ([int]$t.monitor -ge $state.monitors.Count) { Fail "INVALID_ARGUMENT" "monitor index $($t.monitor) out of range (have $($state.monitors.Count))" }
    $m = $state.monitors[[int]$t.monitor]
    $x = [int]$m.x; $y = [int]$m.y; $w = [int]$m.w; $h = [int]$m.h
  } elseif ($null -ne $t.window) {
    $info = [W]::WindowInfo([IntPtr][long]$t.window) -split ",", 8
    if ([long]$info[0] -eq 0) { Fail "WINDOW_NOT_FOUND" "no window with hwnd $($t.window)" }
    $x = [int]$info[2]; $y = [int]$info[3]; $w = [int]$info[4]; $h = [int]$info[5]
    if ($x -lt $vs.x) { $w -= ($vs.x - $x); $x = [int]$vs.x }
    if ($y -lt $vs.y) { $h -= ($vs.y - $y); $y = [int]$vs.y }
    if ($x + $w -gt $vs.x + $vs.w) { $w = [int]($vs.x + $vs.w - $x) }
    if ($y + $h -gt $vs.y + $vs.h) { $h = [int]($vs.y + $vs.h - $y) }
    if ($w -le 0 -or $h -le 0) { Fail "ACTION_FAILED" "window $($t.window) has no visible on-screen area" }
  } elseif ($null -ne $t.x) {
    $x = [int]$t.x; $y = [int]$t.y; $w = [int]$t.w; $h = [int]$t.h
    if ($x -lt $vs.x -or $y -lt $vs.y -or ($x + $w) -gt ($vs.x + $vs.w) -or ($y + $h) -gt ($vs.y + $vs.h)) {
      Fail "INVALID_ARGUMENT" "requested region is outside the virtual screen" # reject, never clamp
    }
  }
  Add-Type -AssemblyName System.Drawing
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size($w, $h)))
  $g.Dispose()
  $scale = 1.0; $iw = $w; $ih = $h
  $maxDim = 0; if ($req.max_dimension) { $maxDim = [int]$req.max_dimension }
  if ($maxDim -gt 0 -and ($w -gt $maxDim -or $h -gt $maxDim)) {
    $f = $maxDim / [double][Math]::Max($w, $h)
    $iw = [Math]::Max(1, [int][Math]::Round($w * $f)); $ih = [Math]::Max(1, [int][Math]::Round($h * $f))
    $small = New-Object System.Drawing.Bitmap($iw, $ih)
    $g2 = [System.Drawing.Graphics]::FromImage($small)
    $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g2.DrawImage($bmp, 0, 0, $iw, $ih); $g2.Dispose(); $bmp.Dispose(); $bmp = $small
    $scale = $iw / [double]$w
  }
  $thumbB64 = Get-Thumbprint $bmp
  $shotB64 = $null; $format = "png"
  if (-not $req.thumbprint_only) {
    if ($req.format) { $format = [string]$req.format }
    $ms = New-Object System.IO.MemoryStream
    if ($format -eq "jpeg") {
      $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
      $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
      $q = 80; if ($req.quality) { $q = [int]$req.quality }
      $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$q)
      $bmp.Save($ms, $codec[0], $ep)
    } else { $format = "png"; $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png) }
    $shotB64 = [Convert]::ToBase64String($ms.ToArray()); $ms.Dispose()
  }
  $bmp.Dispose()
  Write-McpResult @{ ok = $true; data = @{
    screenshot_b64 = $shotB64; format = $format; width = $iw; height = $ih
    origin = @{ x = $x; y = $y }; scale = $scale; region = @{ x = $x; y = $y; w = $w; h = $h }
    thumbprint_b64 = $thumbB64; monitors = $state.monitors; virtual_screen = $state.virtual_screen
    foreground = $state.foreground; cursor = $state.cursor; timestamp = $state.timestamp } }
} catch { if ($null -eq $global:CC_RESULT) { Fail "BACKEND_ERROR" $_.Exception.Message } else { throw } }
