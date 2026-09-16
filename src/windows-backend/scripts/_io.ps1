$ErrorActionPreference = "Stop"
function Read-McpRequest {
  # Under the persistent worker the request arrives via an injected global;
  # standalone invocations still read one base64 line from stdin.
  if ($global:CC_WORKER -and $null -ne $global:CC_REQ) { return $global:CC_REQ }
  $line = [Console]::In.ReadLine()
  if ([string]::IsNullOrWhiteSpace($line)) { throw "empty request on stdin" }
  $json = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line.Trim()))
  return ($json | ConvertFrom-Json)
}
function Write-McpResult([object]$obj) {
  if ($global:CC_WORKER) { $global:CC_RESULT = $obj; return }
  $json = ConvertTo-Json -InputObject $obj -Depth 16 -Compress
  $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json))
  [Console]::Out.Write("###MCP###"); [Console]::Out.Write($b64); [Console]::Out.Flush()
}
function Fail([string]$code, [string]$message) {
  Write-McpResult @{ ok = $false; error = @{ code = $code; message = $message } }
  if ($global:CC_WORKER) { throw "###CC_FAIL###" }
  exit 0
}
# Compile a model-supplied regex with a hard .NET match timeout so a
# pathological pattern cannot stall perception (G8). Invalid patterns surface
# as INVALID_ARGUMENT rather than a crash.
function New-BoundedRegex([string]$pattern, [int]$timeoutMs) {
  $t = 250; if ($timeoutMs -gt 0) { $t = $timeoutMs }
  try {
    return [System.Text.RegularExpressions.Regex]::new($pattern, [System.Text.RegularExpressions.RegexOptions]::None, [TimeSpan]::FromMilliseconds($t))
  } catch { throw (New-Object System.Exception("invalid regex: $($_.Exception.Message)")) }
}
function Test-BoundedRegex($re, [string]$s) {
  if ($null -eq $re) { return $false }
  try { return $re.IsMatch($s) } catch { return $false }
}
