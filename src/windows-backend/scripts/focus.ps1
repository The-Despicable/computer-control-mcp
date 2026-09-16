. "$PSScriptRoot\_io.ps1"; . "$PSScriptRoot\_win32.ps1"; . "$PSScriptRoot\_state.ps1"
try {
  [void][W]::SetProcessDPIAware()
  $req = Read-McpRequest
  if (-not $req.hwnd) { Fail "INVALID_ARGUMENT" "hwnd is required" }
  $r = [W]::FocusWindow([long]$req.hwnd)
  if ($r -eq "not_found") { Fail "WINDOW_NOT_FOUND" "no visible top-level window with hwnd $($req.hwnd)" }
  if ($r -ne "ok") { Fail "ACTION_FAILED" "could not bring hwnd $($req.hwnd) to foreground (OS foreground lock)" }
  $state = Get-UiState
  if (-not $state.foreground -or [long]$state.foreground.hwnd -ne [long]$req.hwnd) {
    Fail "ACTION_FAILED" "focus verification failed"
  }
  Write-McpResult @{ ok = $true; data = $state }
} catch { if ($null -eq $global:CC_RESULT) { Fail "BACKEND_ERROR" $_.Exception.Message } else { throw } }
