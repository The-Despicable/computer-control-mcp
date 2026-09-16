# Persistent PowerShell worker (G6).
#
# Reads request frames from stdin, dispatches to the existing helper scripts
# in-process (dot-sourced so Add-Type runs once), and writes correlated
# response frames. Helper scripts detect worker mode via $global:CC_WORKER and
# route their result through $global:CC_RESULT instead of stdout; Fail throws
# instead of exit-ing so the worker survives.
#
#   in : ###REQ###<base64(JSON { id, script, payload })>\n
#   out: ###RES###<base64(JSON { id, ok, data } | { id, ok:false, error })>\n
$ErrorActionPreference = "Stop"
$global:CC_WORKER = $true

function Write-WorkerError([string]$id, [string]$code, [string]$message) {
  $obj = @{ id = $id; ok = $false; error = @{ code = $code; message = $message } }
  $json = ConvertTo-Json -InputObject $obj -Depth 16 -Compress
  $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json))
  [Console]::Out.Write("###RES###" + $b64 + "`n")
  [Console]::Out.Flush()
}
function Write-WorkerOk([string]$id, $data) {
  $obj = @{ id = $id; ok = $true; data = $data }
  $json = ConvertTo-Json -InputObject $obj -Depth 16 -Compress
  $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json))
  [Console]::Out.Write("###RES###" + $b64 + "`n")
  [Console]::Out.Flush()
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if (-not $line.StartsWith("###REQ###")) { continue }
  $id = ""
  try {
    $json = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line.Substring(9).Trim()))
    $req = $json | ConvertFrom-Json
    $id = [string]$req.id
    $scriptName = [string]$req.script
    if ($scriptName -notmatch '^[A-Za-z0-9_\-]+\.ps1$') { Write-WorkerError $id "INVALID_ARGUMENT" "bad script name"; continue }
    $scriptPath = Join-Path $PSScriptRoot $scriptName
    if (-not (Test-Path $scriptPath)) { Write-WorkerError $id "BACKEND_ERROR" "helper missing: $scriptName"; continue }

    $global:CC_REQ = $req.payload
    $global:CC_RESULT = $null
    try {
      . $scriptPath
    } catch {
      # Fail() throws after storing a structured result; other errors are unexpected.
      if ($null -eq $global:CC_RESULT) {
        Write-WorkerError $id "BACKEND_ERROR" ([string]$_.Exception.Message)
        continue
      }
    }
    if ($null -eq $global:CC_RESULT) { Write-WorkerError $id "BACKEND_ERROR" "$scriptName produced no result"; continue }
    if ($global:CC_RESULT.ok -eq $true) { Write-WorkerOk $id $global:CC_RESULT.data }
    else { Write-WorkerError $id ([string]$global:CC_RESULT.error.code) ([string]$global:CC_RESULT.error.message) }
  } catch {
    if ($id) { Write-WorkerError $id "BACKEND_ERROR" ([string]$_.Exception.Message) }
  }
}
