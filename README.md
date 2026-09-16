# computer-control MCP

Windows-first computer-control MCP server: observe/act/wait with safety bindings.
Muse (OMP) stays the development orchestrator; the worker model stays the reasoning
worker; this MCP is the computer capability layer only.

## Architecture

```text
OMP/Muse (workspace ownership, loop/retry/recovery, independent verification)
  -> reasoning worker (GLM / DeepSeek / ChatGPT / etc., focused context only)
  -> Computer Control MCP (observation, perception, mouse, keyboard, window control, sync, safety)
    -> Windows desktop (screen, mouse, keyboard)
```

The MCP contains no provider logic, no dev-loop logic, no project-ownership tools.

## Tool registry (14)

`observe`, `window_list`, `window_focus`, `find_text`, `find_element`,
`click`, `type`, `key_press`, `scroll`, `drag`, `read_text`, `wait`,
`wait_for_text`, `wait_for_change`. Schemas self-describe via `tools/list`.
Perception ladder: `find_text`/`find_element` first, `observe` when visual
reasoning is genuinely required, workspace/files/tests/git for project truth.

## Observation model & screen_id

Every perception/focus tool returns a fresh `screen_id`. Mutations require one, must
arrive within `COMPUTER_CONTROL_MAX_OBSERVATION_AGE_MS`, and are re-gated in-process
immediately before injection (foreground HWND + virtual-screen geometry +
monitor-layout hash). `click`/`scroll`/`drag` accept `space: image|desktop|monitor`.
`window_focus` resolves the target, checks the allowlist BEFORE focusing, focuses,
verifies, then mints a fresh `screen_id`.

### FullUiState vs MutationGateState

`Get-UiState` (FullUiState) is what a binding needs: monitors, virtual screen,
foreground (with process metadata), cursor, timestamp. The pre-injection gate
uses `Get-MutationGateState` — foreground HWND + virtual screen + monitor hash
only. It is deliberately minimal, is never used to mint a binding, and does not
replace the injection-time PowerShell revalidation, which remains authoritative.
`window_focus` uses a single-hwnd lookup (`window_info.ps1`), not a full
enumeration.

### Window geometry convention

Window bounds everywhere (enumeration, foreground, window-target capture) are
**DWM extended-frame bounds** (`DWMWA_EXTENDED_FRAME_BOUNDS`), falling back to
`GetWindowRect` only when DWM is unavailable. One convention, no ad-hoc offsets.

## Mutation receipts & outcome states

Every mutation (`click`, `type`, `key_press`, `scroll`, `drag`, `window_focus`)
returns a receipt and an explicit outcome:

- **CONFIRMED** — dispatched and the backend reported success.
- **REJECTED** — known NOT executed: validation/policy failed before dispatch
  (`NO_OBSERVATION`, `STALE_SCREEN`, `POLICY_DENIED`, `INVALID_COORDINATE`,
  `UNKNOWN_KEY`, `WINDOW_NOT_FOUND`, `INVALID_ARGUMENT`).
- **UNCERTAIN** — dispatch may have happened but the outcome could not be
  established (transport timeout after dispatch, worker death after the request
  was written, truncated communication).

Errors carry `status`, `mutation_id`, `operation` and `reason`. The MCP reports
evidence only: it never retries or compensates. Interpreting `UNCERTAIN` belongs
to the worker/session layer.

## Perception / OCR

`find_text` uses UI Automation first, then OCR. The OCR path is tiled in
TypeScript (`src/core/ocr.ts`): a region larger than `OcrEngine.MaxImageDimension`
is split into a **2-dimensional grid**, every tile is recognized, and tile-local
boxes are offset back to global coordinates. `truncated` is `true` only when
something was actually omitted/capped (a failed tile or the match cap); fully
tiling an oversized region does **not** set it. Regex filtering is compiled with
an explicit .NET match timeout (see below).

## Long content (`read_text`)

`read_text` reads the foreground window's structured text via UI Automation
(TextPattern first, ValuePattern fallback) with **no screenshot, no scrolling and
no OCR**. Output is a bounded page (`offset`, `limit` default 4000, maximum fetch
200000 chars); `truncated`/`total_known` are truthful. An optional `screen_id`
pins the read to an observation's foreground window. Target identity is
**HWND + owner PID**, verified before the read and re-checked after it: an
`expected_hwnd`/`expected_pid` mismatch returns `FOREGROUND_CHANGED`, and an HWND
that was destroyed or reused by another process during the read returns
`STALE_SCREEN` with the text discarded (never another window's content reported
as the bound target). The MCP returns content only; the worker decides what it
means and how to page. This replaces observe→scroll→observe for reading terminal
or document text.

## Bounded regex
Model-supplied regex is validated in TypeScript (length cap + syntax) before any
evaluation, and the PowerShell matcher compiles patterns with a hard .NET
`TimeSpan` match timeout. A pathological pattern cannot stall perception.

## Typing transports

`type` prefers clipboard paste (atomic; prior clipboard saved and restored) and
falls back to direct Unicode `SendInput` when the clipboard is unavailable. The
result reports `transport: "clipboard" | "unicode"`. `type` can never express a
shortcut — control characters are rejected; use `key_press` for keys/chords.

## PowerShell execution

By default the backend runs a **persistent PowerShell worker pool**
(`worker.ps1`; request/response frames correlated by id), so `Add-Type` and
startup cost are paid once. `COMPUTER_CONTROL_PS_MODE=auto` (default) falls back
to the spawn-per-call path if the worker cannot start; `worker` forces the pool;
`spawn` forces per-call. Workers are health-checked, restarted on crash, and
closed on shutdown.

### Lanes (concurrency)

Two lanes isolate resource contention:

- **control** (`windows.ps1`, `window_info.ps1`, `focus.ps1`, `state.ps1`,
  `input.ps1`) — cheap window discovery/switching and mutations.
- **perception** (`capture.ps1`, `perception.ps1`, `ocr.ps1`) — capture/UIA/OCR.

A slow UIA traversal or OCR can therefore never starve a window switch or a
mutation. Mutations remain serialized by the mutation lock; lanes only isolate
resources. Sizes: `COMPUTER_CONTROL_PS_CONTROL_POOL` (default 1),
`COMPUTER_CONTROL_PS_PERCEPTION_POOL` (default 2; legacy `COMPUTER_CONTROL_PS_POOL`).

### Fast paths

- Process names come from Win32 `QueryFullProcessImageName` (never the
  `Get-Process` cmdlet, never the host PID).
- `window_focus` resolves exactly **one** hwnd (`window_info.ps1`) instead of
  enumerating every window and every process.
- Shared helpers are loaded once per session (`_bootstrap.ps1`); the persistent
  worker no longer re-parses them per request.
- `COMPUTER_CONTROL_SETTLE_MS` (default 60) tunes the post-injection settle
  before the post-state binding is read (fail-safe).

## Performance instrumentation

Set `COMPUTER_CONTROL_TIMING=1` (or `COMPUTER_CONTROL_LOG=debug`) to emit
structured `[computer-control][timing]` lines on stderr: per-tool `total_ms`,
per-script `queue_wait_ms`/`run_ms`/`lane`, and in-worker stage timings
(`state_ms`, `uia_ms`, `capture_ms`, `encode_ms`, `thumb_ms`, `gate_ms`,
`inject_ms`, `post_ms`, `focus_ms`, `win32_ms`, `enum_ms`, `worker_exec_ms`).
Instrumentation is off by default.


## Startup capability probe

At startup the server probes platform, PowerShell availability and version,
helper presence and OCR availability, and logs a truthful report. On Linux/WSL
it reports `backend_ready: false` and tools keep returning structured
`BACKEND_ERROR` (it does not crash). Set `COMPUTER_CONTROL_REQUIRE_WINDOWS=true`
to fail startup on Windows when the backend is not ready.

## Safety

`NO_OBSERVATION`, `STALE_SCREEN`, `FOREGROUND_CHANGED`, `INVALID_COORDINATE`,
`UNKNOWN_KEY`, `POLICY_DENIED`, `TIMEOUT`, `ACTION_FAILED`, `WINDOW_NOT_FOUND`,
`INVALID_ARGUMENT`, `BACKEND_ERROR`, `INTERNAL_ERROR`. Never clamps coordinates,
redirects stale input, reinterprets timeouts, remaps unknown keys, or injects after
failed foreground validation. `drag` validates both endpoints and re-checks the
foreground/monitor layout immediately before injection.

## Windows requirements

Windows 10 1809+/11, interactive desktop session, Windows PowerShell 5.1
(`pwsh` unsupported: WinRT OCR unavailable), Node >= 18.19. Owner PID via
`GetWindowThreadProcessId`, never `$PID`. OCR needs an installed language pack
(`ocr_available` reported per call). Elevated targets need an equally elevated server.

## MCP client config

```json
{
  "mcpServers": {
    "computer-control": {
      "command": "node",
      "args": ["C:\\path\\to\\keyboard\\dist\\src\\index.js"],
      "env": { "COMPUTER_CONTROL_INPUT_ENABLED": "true", "COMPUTER_CONTROL_ALLOWED_PIDS": "12345" }
    }
  }
}
```

Works from Windows paths, UNC paths, and WSL-hosted paths via Windows Node.

## Known limitations

No window-metadata cache (single-hwnd lookup instead, to avoid cache-invalidation
complexity); no drag path scripting (basic validated primitive only); ValuePattern
matches report whole-control bounds; OS foreground lock can deny focus (verified,
fails loudly); change detection is 8x8-thumbprint based (structural + brightness);
single stdio client; OCR/UIA cost is dominated by the target app's accessibility
tree, not the MCP.

## Test commands

`npm run build` · `npm test` (unit suite) · `npm run gate:b` · `npm run gate:c` ·
`npm run gate:d` · `npm run gate:e`. Report NOT RUN with reason for anything the
environment cannot execute.
