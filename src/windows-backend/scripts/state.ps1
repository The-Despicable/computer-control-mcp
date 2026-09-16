. "$PSScriptRoot\_bootstrap.ps1"
try {
  [void][W]::SetProcessDPIAware()
  $t = [System.Diagnostics.Stopwatch]::StartNew()
  $s = Get-UiState
  $ms = $t.ElapsedMilliseconds
  $s.timing = @{ win32_ms = $ms }
  Write-McpResult @{ ok = $true; data = $s }
} catch { if ($null -eq $global:CC_RESULT) { Fail "BACKEND_ERROR" $_.Exception.Message } else { throw } }
