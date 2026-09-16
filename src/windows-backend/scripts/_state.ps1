function Get-MonitorsHash($monitors) {
  ($monitors | ForEach-Object { "$($_.x),$($_.y),$($_.w),$($_.h)" }) -join "|"
}
function Get-MonitorList {
  $monitors = @(); $i = 0
  foreach ($s in ([W]::GetMonitors())) {
    $p = $s -split ",", 9
    $scale = $null
    if ($p[6] -eq "1" -and [int]$p[7] -gt 0) { $scale = [Math]::Round(([int]$p[7]) / 96.0, 2) }
    $monitors += ,@{ index = $i; x = [int]$p[1]; y = [int]$p[2]; w = [int]$p[3]; h = [int]$p[4];
                     scale = $scale; primary = ($p[5] -eq "1"); device = [string]$p[8] }
    $i++
  }
  return , $monitors
}
function Get-VirtualScreenRect {
  $vs = [W]::VirtualScreen()
  return @{ x = $vs.Left; y = $vs.Top; w = ($vs.Right - $vs.Left); h = ($vs.Bottom - $vs.Top) }
}

# FullUiState — everything an observation binding needs. Process metadata is
# resolved with the fast Win32 helper (never the Get-Process cmdlet, never the
# PowerShell host PID).
function Get-UiState {
  $monitors = Get-MonitorList
  $vs = Get-VirtualScreenRect
  $fg = [W]::ForegroundInfo() -split ",", 8
  $fgObj = $null
  if ([long]$fg[0] -ne 0) {
    $proc = [W]::ProcessName([uint32]$fg[1])
    $fgObj = @{ hwnd = [long]$fg[0]; pid = [int]$fg[1]; process = $proc; title = [string]$fg[7]
                bounds = @{ x = [int]$fg[2]; y = [int]$fg[3]; w = [int]$fg[4]; h = [int]$fg[5] } }
  }
  $cur = [W]::GetCursor() -split ","
  return @{
    monitors = $monitors
    virtual_screen = $vs
    foreground = $fgObj
    cursor = @{ x = [int]$cur[0]; y = [int]$cur[1] }
    timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  }
}

# MutationGateState — the MINIMAL state the pre-injection gate needs:
# foreground HWND, virtual screen, monitor hash. Deliberately NOT a general
# observation state: no cursor, no process metadata, no title/bounds. It is
# only ever used to revalidate immediately before SendInput; the injection-time
# PowerShell check remains authoritative.
function Get-MutationGateState {
  $monitors = Get-MonitorList
  return @{
    monitors = $monitors
    virtual_screen = Get-VirtualScreenRect
    monitors_hash = (Get-MonitorsHash $monitors)
    foreground_hwnd = [W]::GetForegroundWindow().ToInt64()
  }
}
