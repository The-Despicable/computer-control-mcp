function Get-MonitorsHash($monitors) {
  ($monitors | ForEach-Object { "$($_.x),$($_.y),$($_.w),$($_.h)" }) -join "|"
}
function Get-UiState {
  $monitors = @(); $i = 0
  foreach ($s in ([W]::GetMonitors())) {
    $p = $s -split ",", 9
    $scale = $null
    if ($p[6] -eq "1" -and [int]$p[7] -gt 0) { $scale = [Math]::Round(([int]$p[7]) / 96.0, 2) }
    $monitors += ,@{ index = $i; x = [int]$p[1]; y = [int]$p[2]; w = [int]$p[3]; h = [int]$p[4];
                     scale = $scale; primary = ($p[5] -eq "1"); device = [string]$p[8] }
    $i++
  }
  $vs = [W]::VirtualScreen()
  $fg = [W]::ForegroundInfo() -split ",", 8
  $fgObj = $null
  if ([long]$fg[0] -ne 0) {
    $proc = ""
    try { $proc = (Get-Process -Id ([int]$fg[1]) -ErrorAction Stop).ProcessName } catch {}
    $fgObj = @{ hwnd = [long]$fg[0]; pid = [int]$fg[1]; process = $proc; title = [string]$fg[7]
                bounds = @{ x = [int]$fg[2]; y = [int]$fg[3]; w = [int]$fg[4]; h = [int]$fg[5] } }
  }
  $cur = [W]::GetCursor() -split ","
  return @{
    monitors = $monitors
    virtual_screen = @{ x = $vs.Left; y = $vs.Top; w = ($vs.Right - $vs.Left); h = ($vs.Bottom - $vs.Top) }
    foreground = $fgObj
    cursor = @{ x = [int]$cur[0]; y = [int]$cur[1] }
    timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  }
}
