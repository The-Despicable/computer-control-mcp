# Bounded UIA text read. Returns up to `max_chars` of the foreground window's
# text via TextPattern (preferred) or ValuePattern (fallback). Paging/offset
# slicing is done in TypeScript (src/core/text.ts). Never OCRs — structured UIA
# text first and only. Never scrolls the viewport. Never mutates state.
#
# Target provenance: identity is HWND + owner PID. It is checked BEFORE the read
# (expected_hwnd/expected_pid) and recorded again AFTER the read (start_pid /
# end_pid / window_valid). The TypeScript layer decides success from that
# evidence, so an HWND reused by another process or a window destroyed mid-read
# can never be returned as a successful read of the original target.
. "$PSScriptRoot\_bootstrap.ps1"
try {
  [void][W]::SetProcessDPIAware()
  $req = Read-McpRequest
  $max = [int]$req.max_chars
  if ($max -le 0) { $max = 4000 }
  if ($max -gt 200000) { $max = 200000 }

  $fg = [W]::GetForegroundWindow().ToInt64()
  if ($fg -eq 0) { Fail "ACTION_FAILED" "no foreground window" }

  # Identity BEFORE the read.
  $startInfo = [W]::WindowInfo([IntPtr]$fg) -split ",", 8
  $startPid = [int]$startInfo[1]
  if ($req.expected_hwnd -and ([long]$req.expected_hwnd -ne $fg)) {
    Fail "FOREGROUND_CHANGED" "foreground window changed since the observation; text NOT read"
  }
  if ($req.expected_pid -and ([int]$req.expected_pid -ne $startPid)) {
    Fail "FOREGROUND_CHANGED" "bound window identity changed (hwnd reused by another process); text NOT read"
  }

  $tAdd = [System.Diagnostics.Stopwatch]::StartNew()
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
  $addMs = $tAdd.ElapsedMilliseconds

  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$fg)
  $focused = [System.Windows.Automation.AutomationElement]::FocusedElement

  $best = ""; $bestType = ""
  $value = ""; $valueType = ""
  $nodes = 0
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $stack = New-Object System.Collections.Stack
  if ($null -ne $root) { $stack.Push($root) }
  if ($null -ne $focused) { $stack.Push($focused) }

  while ($stack.Count -gt 0 -and $nodes -lt 3000 -and $sw.ElapsedMilliseconds -lt 3000) {
    $el = $stack.Pop(); $nodes++
    if ($null -eq $el) { continue }
    try {
      $ctype = ""
      try { $ctype = ($el.Current.ControlType.ProgrammaticName -replace "^ControlType\.", "") } catch {}
      $pat = $null
      if ($el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pat)) {
        $t = [string]$pat.DocumentRange.GetText($max)
        if ($t.Length -gt $best.Length) { $best = $t; $bestType = $ctype }
        if (($ctype -eq "Document" -or $ctype -eq "Edit") -and $t.Length -gt 0) { break }
      }
      if ($best.Length -eq 0) {
        $vp = $null
        if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
          $v = [string]$vp.Current.Value
          if ($v.Length -gt $value.Length) { $value = $v; $valueType = $ctype }
        }
      }
      $child = $walker.GetFirstChild($el)
      while ($null -ne $child) { $stack.Push($child); $child = $walker.GetNextSibling($child) }
    } catch { continue }
  }
  $uiaMs = $sw.ElapsedMilliseconds

  # Identity AFTER the read (the same HWND must still be the same owner).
  $endInfo = [W]::WindowInfo([IntPtr]$fg) -split ",", 8
  $endPid = [int]$endInfo[1]
  $windowValid = [bool][W]::IsWindow([IntPtr]$fg)
  $startTitle = [string]$startInfo[7]

  $source = "none"; $text = ""; $ctypeOut = $null; $complete = $true
  if ($best.Length -gt 0) {
    $source = "text"; $text = $best; $ctypeOut = $bestType; $complete = ($best.Length -lt $max)
  } elseif ($value.Length -gt 0) {
    $source = "value"; $ctypeOut = $valueType
    if ($value.Length -gt $max) { $text = $value.Substring(0, $max); $complete = $false }
    else { $text = $value; $complete = $true }
  }

  Write-McpResult @{ ok = $true; data = @{
    text = $text; complete = $complete; source = $source; control_type = $ctypeOut
    chars = $text.Length; nodes_visited = $nodes
    identity = @{ hwnd = [long]$fg; start_pid = $startPid; end_pid = $endPid; window_valid = $windowValid }
    target = @{ hwnd = [long]$fg; pid = $startPid; process = [W]::ProcessName([uint32]$startPid); title = $startTitle }
    timing = @{ addtype_ms = $addMs; uia_ms = $uiaMs } } }
} catch { if ($null -eq $global:CC_RESULT) { Fail "BACKEND_ERROR" $_.Exception.Message } else { throw } }
