import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Structural regression guard for the fast process-name replacement.
//
// The safety-critical invariant is: the process name attached to a window is
// derived from the window's OWNER pid, which must come from
// GetWindowThreadProcessId (via ForegroundInfo/WindowInfo) — never from the
// PowerShell host, and never from some other handle. These assertions fail if a
// future change re-sources the pid or reintroduces the Get-Process cmdlet on the
// hot paths.
function script(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../src/windows-backend/scripts/${name}`, import.meta.url)), "utf8");
}
// Strip comment-only and trailing comments so assertions test executable code,
// not prose that legitimately names the thing we removed.
function code(name: string): string {
  return script(name)
    .split("\n")
    .map(l => l.replace(/\/\/.*$/, "").replace(/#.*$/, ""))
    .filter(l => l.trim().length > 0)
    .join("\n");
}

test("_win32.ps1 resolves process names from a pid, via Win32 (not Get-Process)", () => {
  const s = script("_win32.ps1");
  assert.match(s, /ProcessName\(uint pid\)/);
  assert.match(s, /QueryFullProcessImageName/);
  assert.match(s, /GetWindowThreadProcessId/);
  assert.match(s, /WindowInfo\(/);
  assert.doesNotMatch(code("_win32.ps1"), /Get-Process\b/, "Get-Process cmdlet must not be used");
});

test("_state.ps1 ties the foreground process name to the window's owner pid", () => {
  const s = code("_state.ps1");
  // pid comes from ForegroundInfo's second CSV field (hwnd,pid,...)
  assert.match(s, /ForegroundInfo\(\)/);
  assert.match(s, /ProcessName\(\[uint32\]\$fg\[1\]\)/);
  assert.doesNotMatch(s, /Get-Process\b/, "Get-Process cmdlet must not be used");
  assert.doesNotMatch(s, /\$PID\b/, "the PowerShell host PID must never be referenced");
});

test("_state.ps1 defines FullUiState and the minimal MutationGateState separately", () => {
  const s = script("_state.ps1");
  assert.match(s, /function Get-UiState/);
  assert.match(s, /function Get-MutationGateState/);
  assert.match(s, /foreground_hwnd\s*=\s*\[W\]::GetForegroundWindow\(\)\.ToInt64\(\)/);
  // the gate state must not carry cursor/process metadata (minimal by design)
  const gate = code("_state.ps1").slice(code("_state.ps1").indexOf("function Get-MutationGateState"));
  assert.doesNotMatch(gate, /GetCursor|ProcessName|title/);
});

test("windows.ps1 uses the Win32 process helper, not Get-Process", () => {
  const s = code("windows.ps1");
  assert.match(s, /ProcessName\(\[uint32\]\$pid2\)/);
  assert.doesNotMatch(s, /Get-Process\b/);
});

test("window_info.ps1 resolves one hwnd's real owner pid and enforces top-level", () => {
  const s = code("window_info.ps1");
  assert.match(s, /WindowInfo\(\$ptr\)/);
  assert.match(s, /\$pid2\s*=\s*\[int\]\$s\[1\]/);
  assert.match(s, /ProcessName\(\[uint32\]\$pid2\)/);
  assert.match(s, /GetAncestor\(\$ptr, 2\)/);
  assert.doesNotMatch(s, /Get-Process\b/);
});

test("input.ps1 pre-gate uses the minimal MutationGateState (no full UI state)", () => {
  const s = code("input.ps1");
  assert.match(s, /\$gate\s*=\s*Get-MutationGateState/);
  assert.match(s, /\$gate\.foreground_hwnd/);
  assert.match(s, /\$gate\.monitors_hash/);
});

test("read_text.ps1 enforces HWND+PID identity before and records it after the read", () => {
  const s = code("read_text.ps1");
  assert.match(s, /\$req\.expected_pid/);
  assert.match(s, /\$startPid\s*=\s*\[int\]\$startInfo\[1\]/);
  assert.match(s, /\$endPid\s*=\s*\[int\]\$endInfo\[1\]/);
  assert.match(s, /\$windowValid\s*=\s*\[bool\]\[W\]::IsWindow/);
  assert.match(s, /start_pid\s*=\s*\$startPid/);
  assert.match(s, /end_pid\s*=\s*\$endPid/);
});
