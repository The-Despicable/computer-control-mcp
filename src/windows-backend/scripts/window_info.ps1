# Single-window lookup for window_focus target resolution. Queries exactly ONE
# hwnd (pid via GetWindowThreadProcessId, title, frame bounds, iconic) instead
# of enumerating every top-level window and every PID. Fresh per call; never a
# cache, so it cannot become stale authorization state.
. "$PSScriptRoot\_bootstrap.ps1"
try {
  [void][W]::SetProcessDPIAware()
  $t = [System.Diagnostics.Stopwatch]::StartNew()
  $req = Read-McpRequest
  $h = [long]$req.hwnd
  if (-not $h) { Fail "INVALID_ARGUMENT" "hwnd is required" }
  $ptr = [IntPtr]$h
  if (-not [W]::IsWindow($ptr) -or -not [W]::IsWindowVisible($ptr)) { Fail "WINDOW_NOT_FOUND" "no visible top-level window with hwnd $h" }
  # Top-level only, matching window_list semantics (GA_ROOT == self).
  if ([W]::GetAncestor($ptr, 2) -ne $ptr) { Fail "WINDOW_NOT_FOUND" "hwnd $h is not a top-level window" }
  $s = [W]::WindowInfo($ptr) -split ",", 8
  $pid2 = [int]$s[1]
  $fg = [W]::GetForegroundWindow().ToInt64()
  $winMs = $t.ElapsedMilliseconds
  Write-McpResult @{ ok = $true; data = @{
    hwnd = [long]$s[0]; pid = $pid2; process = [W]::ProcessName([uint32]$pid2); title = [string]$s[7]
    bounds = @{ x = [int]$s[2]; y = [int]$s[3]; w = [int]$s[4]; h = [int]$s[5] }
    is_minimized = ($s[6] -eq "1"); is_foreground = ([long]$s[0] -eq $fg)
    timing = @{ win32_ms = $winMs } } }
} catch { if ($null -eq $global:CC_RESULT) { Fail "BACKEND_ERROR" $_.Exception.Message } else { throw } }
