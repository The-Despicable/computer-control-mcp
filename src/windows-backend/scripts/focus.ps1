. "$PSScriptRoot\_bootstrap.ps1"
try {
  [void][W]::SetProcessDPIAware()
  $req = Read-McpRequest
  if (-not $req.hwnd) { Fail "INVALID_ARGUMENT" "hwnd is required" }
  $tFocus = [System.Diagnostics.Stopwatch]::StartNew()
  $r = [W]::FocusWindow([long]$req.hwnd)
  $focusMs = $tFocus.ElapsedMilliseconds
  if ($r -eq "not_found") { Fail "WINDOW_NOT_FOUND" "no visible top-level window with hwnd $($req.hwnd)" }
  if ($r -ne "ok") { Fail "ACTION_FAILED" "could not bring hwnd $($req.hwnd) to foreground (OS foreground lock)" }
  $tState = [System.Diagnostics.Stopwatch]::StartNew()
  $state = Get-UiState
  $stateMs = $tState.ElapsedMilliseconds
  if (-not $state.foreground -or [long]$state.foreground.hwnd -ne [long]$req.hwnd) {
    Fail "ACTION_FAILED" "focus verification failed"
  }
  $state.timing = @{ focus_ms = $focusMs; state_ms = $stateMs }
  Write-McpResult @{ ok = $true; data = $state }
} catch { if ($null -eq $global:CC_RESULT) { Fail "BACKEND_ERROR" $_.Exception.Message } else { throw } }
