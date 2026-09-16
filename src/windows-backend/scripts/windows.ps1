. "$PSScriptRoot\_io.ps1"; . "$PSScriptRoot\_win32.ps1"; . "$PSScriptRoot\_state.ps1"
try {
  [void][W]::SetProcessDPIAware()
  $state = Get-UiState
  $wins = @(); $procCache = @{}; $z = 0
  foreach ($s in ([W]::GetWindows())) {
    $p = $s -split ",", 8
    $pid2 = [int]$p[1]
    if (-not $procCache.ContainsKey($pid2)) {
      try { $procCache[$pid2] = (Get-Process -Id $pid2 -ErrorAction Stop).ProcessName } catch { $procCache[$pid2] = "" }
    }
    $wins += ,@{
      hwnd = [long]$p[0]; pid = $pid2; process = $procCache[$pid2]; title = [string]$p[7]
      bounds = @{ x = [int]$p[2]; y = [int]$p[3]; w = [int]$p[4]; h = [int]$p[5] }
      is_minimized = ($p[6] -eq "1"); is_foreground = ($state.foreground -and [long]$p[0] -eq [long]$state.foreground.hwnd)
      z = $z
    }
    $z++
  }
  Write-McpResult @{ ok = $true; data = @{
    windows = $wins; monitors = $state.monitors; virtual_screen = $state.virtual_screen
    foreground = $state.foreground; cursor = $state.cursor; timestamp = $state.timestamp } }
} catch { if ($null -eq $global:CC_RESULT) { Fail "BACKEND_ERROR" $_.Exception.Message } else { throw } }
