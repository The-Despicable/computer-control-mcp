. "$PSScriptRoot\_bootstrap.ps1"
try {
  [void][W]::SetProcessDPIAware()
  $tState = [System.Diagnostics.Stopwatch]::StartNew()
  $state = Get-UiState
  $stateMs = $tState.ElapsedMilliseconds
  $tEnum = [System.Diagnostics.Stopwatch]::StartNew()
  $wins = @(); $procCache = @{}; $z = 0
  foreach ($s in ([W]::GetWindows())) {
    $p = $s -split ",", 8
    $pid2 = [int]$p[1]
    if (-not $procCache.ContainsKey($pid2)) {
      # Fast Win32 name lookup; the pid is the window's real owner pid.
      $procCache[$pid2] = [W]::ProcessName([uint32]$pid2)
    }
    $wins += ,@{
      hwnd = [long]$p[0]; pid = $pid2; process = $procCache[$pid2]; title = [string]$p[7]
      bounds = @{ x = [int]$p[2]; y = [int]$p[3]; w = [int]$p[4]; h = [int]$p[5] }
      is_minimized = ($p[6] -eq "1"); is_foreground = ($state.foreground -and [long]$p[0] -eq [long]$state.foreground.hwnd)
      z = $z
    }
    $z++
  }
  $enumMs = $tEnum.ElapsedMilliseconds
  Write-McpResult @{ ok = $true; data = @{
    windows = $wins; monitors = $state.monitors; virtual_screen = $state.virtual_screen
    foreground = $state.foreground; cursor = $state.cursor; timestamp = $state.timestamp
    timing = @{ state_ms = $stateMs; enum_ms = $enumMs } } }
} catch { if ($null -eq $global:CC_RESULT) { Fail "BACKEND_ERROR" $_.Exception.Message } else { throw } }
