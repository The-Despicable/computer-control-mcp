# Recognize exactly one bounded tile and return lines in TILE-LOCAL pixel
# coordinates. Tiling, coordinate reconstruction and truncation semantics live
# in TypeScript (src/core/ocr.ts) so they are unit-testable without an OCR
# engine. This script is the thin OCR primitive only.
. "$PSScriptRoot\_io.ps1"; . "$PSScriptRoot\_win32.ps1"; . "$PSScriptRoot\_state.ps1"
Add-Type -AssemblyName System.Runtime.WindowsRuntime
# Force WinRT type projection before any New-Object (PowerShell 5.1 needs the
# explicit assembly + ContentType hint the first time).
try { $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] } catch {}
try { $null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime] } catch {}
try { $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] } catch {}
try { $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime] } catch {}
try { $null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime] } catch {}

# Robust WinRT async bridge for PowerShell 5.1: reflection over
# WindowsRuntimeSystemExtensions.AsTask. `$op.GetResults()` on a __ComObject is
# not reliably exposed, so use the system-provided task adapters instead.
function Get-AsTaskMethod([string]$paramTypeName) {
  return ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq $paramTypeName
  } | Select-Object -First 1)
}
if ($null -eq $global:CC_AsTaskOp) {
  $global:CC_AsTaskOp = Get-AsTaskMethod 'IAsyncOperation`1'
  $global:CC_AsTaskAction = Get-AsTaskMethod 'IAsyncAction'
}
function Wait-WinrtOp($op, $resultType) {
  $netTask = $global:CC_AsTaskOp.MakeGenericMethod($resultType).Invoke($null, @($op))
  [void]$netTask.Wait(-1)
  return $netTask.Result
}
function Wait-WinrtAction($action) {
  $netTask = $global:CC_AsTaskAction.Invoke($null, @($action))
  [void]$netTask.Wait(-1)
}
function Get-RegionPng([int]$x, [int]$y, [int]$w, [int]$h) {
  Add-Type -AssemblyName System.Drawing
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size($w, $h)))
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  return , $ms.ToArray()
}

try {
  [void][W]::SetProcessDPIAware()
  $req = Read-McpRequest
  $x = [int]$req.x; $y = [int]$req.y; $w = [int]$req.w; $h = [int]$req.h
  if ($w -le 0 -or $h -le 0) { Fail "INVALID_ARGUMENT" "tile must have positive width/height" }

  $maxDim = 0
  try { $maxDim = [int][Windows.Media.Ocr.OcrEngine]::MaxImageDimension } catch { $maxDim = 0 }
  if ($maxDim -lt 1) { $maxDim = 4096 }
  if ($w -gt $maxDim -or $h -gt $maxDim) { Fail "INVALID_ARGUMENT" "tile ${w}x${h} exceeds OCR max dimension $maxDim (caller must tile)" }

  $engine = $null
  try { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() } catch { $engine = $null }
  if ($null -eq $engine) {
    Write-McpResult @{ ok = $true; data = @{ lines = @(); ocr_available = $false } }
  } else {
    $re = $null
    if ($req.regex) {
      try { $re = New-BoundedRegex ([string]$req.regex) ([int]$req.regex_timeout_ms) }
      catch { Fail "INVALID_ARGUMENT" $_.Exception.Message }
    }
    $png = Get-RegionPng $x $y $w $h
    $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    $writer = New-Object Windows.Storage.Streams.DataWriter($stream.GetOutputStreamAt(0))
    $writer.WriteBytes($png)
    # DataWriterStoreOperation implements IAsyncOperation<uint>, not IAsyncAction.
    [void](Wait-WinrtOp ($writer.StoreAsync()) ([uint32]))
    $stream.Seek(0) | Out-Null
    $decoder = Wait-WinrtOp ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $soft = Wait-WinrtOp ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    if ($soft.BitmapPixelFormat.ToString() -ne "Bgra8" -and $soft.BitmapPixelFormat.ToString() -ne "Gray8") {
      $soft = [Windows.Graphics.Imaging.SoftwareBitmap]::Convert($soft, [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8)
    }
    $res = Wait-WinrtOp ($engine.RecognizeAsync($soft)) ([Windows.Media.Ocr.OcrResult])
    $lines = @()
    foreach ($line in $res.Lines) {
      $text = [string]$line.Text
      if ($re -and -not (Test-BoundedRegex $re $text)) { continue }
      $x0 = [double]::MaxValue; $y0 = [double]::MaxValue; $x1 = 0.0; $y1 = 0.0
      foreach ($word in $line.Words) {
        $r = $word.BoundingRect
        $x0 = [Math]::Min($x0, $r.X); $y0 = [Math]::Min($y0, $r.Y)
        $x1 = [Math]::Max($x1, $r.X + $r.Width); $y1 = [Math]::Max($y1, $r.Y + $r.Height)
      }
      $lines += ,@{
        text = $text
        rect = @{ x = [int][Math]::Floor($x0); y = [int][Math]::Floor($y0)
                  w = [int][Math]::Ceiling($x1 - $x0); h = [int][Math]::Ceiling($y1 - $y0) }
      }
    }
    Write-McpResult @{ ok = $true; data = @{ lines = $lines; ocr_available = $true } }
  }
} catch { if ($null -eq $global:CC_RESULT) { Fail "BACKEND_ERROR" $_.Exception.Message } else { throw } }
