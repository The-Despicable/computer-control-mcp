. "$PSScriptRoot\_io.ps1"; . "$PSScriptRoot\_win32.ps1"; . "$PSScriptRoot\_state.ps1"
try {
  [void][W]::SetProcessDPIAware()
  Write-McpResult @{ ok = $true; data = (Get-UiState) }
} catch { if ($null -eq $global:CC_RESULT) { Fail "BACKEND_ERROR" $_.Exception.Message } else { throw } }
