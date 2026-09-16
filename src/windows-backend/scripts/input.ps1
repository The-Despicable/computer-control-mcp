. "$PSScriptRoot\_bootstrap.ps1"
function Test-OnMonitors([int]$x, [int]$y, $monitors) {
  foreach ($m in $monitors) {
    if ($x -ge $m.x -and $x -lt ($m.x + $m.w) -and $y -ge $m.y -and $y -lt ($m.y + $m.h)) { return $true }
  }
  return $false
}
try {
  [void][W]::SetProcessDPIAware()
  $req = Read-McpRequest

  # MutationGateState only: foreground HWND + virtual screen + monitor hash.
  # No process/cursor work on the gate path.
  $tGate = [System.Diagnostics.Stopwatch]::StartNew()
  $gate = Get-MutationGateState
  $gateMs = $tGate.ElapsedMilliseconds

  # ---- ATOMIC PRE-INJECTION VALIDATION (authoritative, immediately before SendInput) ----
  if ($req.expect) {
    $expectedHwnd = [long]$req.expect.foreground_hwnd
    if ($expectedHwnd -ne [long]$gate.foreground_hwnd) {
      Fail "FOREGROUND_CHANGED" "foreground window changed since the observation; input NOT sent"
    }
    $ev = $req.expect.virtual_screen
    if ($ev) {
      if ([int]$ev.x -ne [int]$gate.virtual_screen.x -or [int]$ev.y -ne [int]$gate.virtual_screen.y -or
          [int]$ev.w -ne [int]$gate.virtual_screen.w -or [int]$ev.h -ne [int]$gate.virtual_screen.h) {
        Fail "STALE_SCREEN" "display geometry changed since the observation; input NOT sent"
      }
    }
    if ($req.expect.monitors_hash) {
      if ([string]$req.expect.monitors_hash -ne [string]$gate.monitors_hash) {
        Fail "STALE_SCREEN" "monitor layout changed since the observation; input NOT sent"
      }
    }
  }

  $tInject = [System.Diagnostics.Stopwatch]::StartNew()
  $r = ""
  $transport = $null
  $clipRestored = $true
  switch ([string]$req.action) {
    "click" {
      $x = [int]$req.x; $y = [int]$req.y
      if (-not (Test-OnMonitors $x $y $gate.monitors)) {
        Fail "INVALID_COORDINATE" "point ($x,$y) is not on any monitor; input NOT sent"
      }
      $count = 1; if ($req.count) { $count = [int]$req.count }
      $button = "left"; if ($req.button) { $button = [string]$req.button }
      $r = [W]::Click($x, $y, $button, $count)
    }
    "drag" {
      $x1 = [int]$req.from.x; $y1 = [int]$req.from.y
      $x2 = [int]$req.to.x; $y2 = [int]$req.to.y
      if (-not (Test-OnMonitors $x1 $y1 $gate.monitors)) {
        Fail "INVALID_COORDINATE" "drag source ($x1,$y1) is not on any monitor; input NOT sent"
      }
      if (-not (Test-OnMonitors $x2 $y2 $gate.monitors)) {
        Fail "INVALID_COORDINATE" "drag destination ($x2,$y2) is not on any monitor; input NOT sent"
      }
      $button = "left"; if ($req.button) { $button = [string]$req.button }
      $duration = 300; if ($null -ne $req.duration_ms) { $duration = [int]$req.duration_ms }
      $r = [W]::Drag($x1, $y1, $x2, $y2, $duration, $button)
    }
    "scroll" {
      $delta = 120 * [int]$req.amount
      if ($req.direction -eq "down") { $delta = -$delta }
      if ($null -ne $req.x -and $null -ne $req.y) {
        if (-not (Test-OnMonitors ([int]$req.x) ([int]$req.y) $gate.monitors)) {
          Fail "INVALID_COORDINATE" "scroll point ($($req.x),$($req.y)) is not on any monitor; input NOT sent"
        }
        $r = [W]::ScrollAt([int]$req.x, [int]$req.y, $delta)
      } else { $r = [W]::ScrollAt($null, $null, $delta) }
    }
    "type" {
      Add-Type -AssemblyName System.Windows.Forms
      $transport = "clipboard"
      $oldClip = $null
      try { $oldClip = [System.Windows.Forms.Clipboard]::GetDataObject() } catch { $oldClip = $null }
      $clipOk = $true
      try { [System.Windows.Forms.Clipboard]::SetText([string]$req.text) } catch { $clipOk = $false }
      if ($clipOk) {
        $r = [W]::SendChord([long[]]@(0x11, 0x56), [bool[]]@($false, $false))
        if ($r -ne "ok") {
          $transport = "unicode"
          $r = [W]::SendUnicode([string]$req.text)
        }
      } else {
        $transport = "unicode"
        $r = [W]::SendUnicode([string]$req.text)
      }
      try {
        if ($null -ne $oldClip) { [System.Windows.Forms.Clipboard]::SetDataObject($oldClip) | Out-Null }
        else { [System.Windows.Forms.Clipboard]::Clear() }
      } catch { $clipRestored = $false }
    }
    "keys" {
      $vks = @(); $ext = @()
      foreach ($k in $req.keys) { $vks += [long]$k.vk; $ext += [bool]$k.ext }
      $r = [W]::SendChord([long[]]$vks, [bool[]]$ext)
    }
    default { Fail "INVALID_ARGUMENT" "unknown action '$($req.action)'" }
  }
  if ($r -ne "ok") { Fail "ACTION_FAILED" "input injection failed: $r (possible UIPI/integrity-level restriction on the target window)" }
  $injectMs = $tInject.ElapsedMilliseconds
  # Settle delay before reading the post-state binding. Configurable; the read
  # is fail-safe (a stale foreground just yields FOREGROUND_CHANGED next time).
  $settle = 60; if ($env:COMPUTER_CONTROL_SETTLE_MS) { try { $settle = [int]$env:COMPUTER_CONTROL_SETTLE_MS } catch {} }
  if ($settle -gt 0) { Start-Sleep -Milliseconds $settle }

  $tPost = [System.Diagnostics.Stopwatch]::StartNew()
  $post = Get-UiState
  $postMs = $tPost.ElapsedMilliseconds
  Write-McpResult @{ ok = $true; data = @{ state = $post; clipboard_restored = $clipRestored; transport = $transport
    timing = @{ gate_ms = $gateMs; inject_ms = $injectMs; post_ms = $postMs } } }
} catch { if ($null -eq $global:CC_RESULT) { Fail "BACKEND_ERROR" $_.Exception.Message } else { throw } }
