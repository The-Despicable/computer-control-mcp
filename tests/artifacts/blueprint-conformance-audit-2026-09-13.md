# Blueprint Conformance Audit — 2026-09-13

Mode: READ-ONLY forensic audit. No src/dist/config/process/window mutation was performed.
Live probes used: `window_list`, `find_text`, `observe` (read-only). No click/type/key_press/scroll/focus was issued by the auditor.
Canonical blueprint file `PROJECT_BLUEPRINT.md` was **not found** in either canonical location. README.md is used as the de-facto spec proxy; absence is itself a finding.

- WSL source: `/home/yaser/keyboard` (via `\\wsl.localhost\Ubuntu\home\yaser\keyboard`)
- Windows execution copy: `C:\gates\keyboard`
- OpenCode config: `C:\Users\yaser\.config\opencode\opencode.json`
- Evidence dir: `C:\gates\` (gate-*.txt, gate-f-muse-native-trace.jsonl UTF-16, worker-*, react-*, probe-*)
- Audit live window: HWND 4523402 / PID 16132 (`OC | Computer Control MCP forensic audit`)

Evidence labels used exactly: [VERIFIED LIVE] [VERIFIED HISTORICALLY] [IMPLEMENTED / UNVERIFIED] [FAILED] [UNKNOWN] [ASPIRATIONAL / NOT IMPLEMENTED]

---

## 0. Critical preamble — missing canonical blueprint

| Claim | Evidence | Status |
|---|---|---|
| `PROJECT_BLUEPRINT.md` exists in WSL source | `Test-Path` False; root contains only `.env.example, dist, node_modules, package.json, README.md, scripts, src, tests, tsconfig.json` | [FAILED] |
| `PROJECT_BLUEPRINT.md` exists in Windows copy | `Test-Path` False; `C:\gates` listing has no blueprint file | [FAILED] |
| CURRENT POSITION marker in blueprint is checkable | No blueprint file, no marker text found by grep over `src+tests` (only `###MCP###` transport marker matches) | [UNKNOWN] |
| README as proxy spec | `README.md` (76 lines) describes 12 tools, safety, architecture OMP→worker→MCP→Windows | [VERIFIED HISTORICALLY] |

Consequence: every "Blueprint Expectation" below is reconstructed from README.md + test-harness intent + the audit prompt's §4/§18 topic list. **No Gate F PASS and no milestone claim can be grounded in a canonical blueprint file today.** Required remediation is to recreate `PROJECT_BLUEPRINT.md` from this audit, not to treat README aspirations as blueprint requirements.

---

## 1. Blueprint conformance audit (README-reconstructed expectations)

| Blueprint Area | Blueprint Expectation (from README / prompt topics) | Actual State | Evidence | Status |
|---|---|---|---|---|
| Project objective | Windows-first computer-control MCP; Muse/OMP orchestrates, worker reasons, MCP is capability only | src contains only observation/perception/input/wait + PS backend; no provider/dev-loop/project-ownership tools in `src` | `src/tools/index.ts` 12 tools; `src/windows-backend/powershell.ts`; grep for NIM/GLM/llama/openai in `src` = none (only `.env` load + PS spawn) | [VERIFIED LIVE] |
| Architecture | OMP/Muse → worker → MCP → Windows → independent verifier | MCP layer exists and is clean; OMP/Muse orchestration has no code; verifier exists only as harness-side checks | README ll.9-16; `worker-harness.mjs` ll.186-204 verification; `gate-e-devloop.mjs` ll.197-206; no `src` orchestrator | [IMPLEMENTED / UNVERIFIED] for full chain; MCP segment [VERIFIED LIVE] |
| Repository layout | src/tests/dist/scripts/package.json/README | Matches, plus `tests/artifacts` (2 JSON results) and `tests/scripts` (16 .mjs) | dir listings 2026-09-12/13 | [VERIFIED LIVE] |
| 12-tool MCP surface | observe, window_list, window_focus, find_text, find_element, click, type, key_press, scroll, wait, wait_for_text, wait_for_change | Exactly these 12 in `TOOLS` array; `tools/list` B2 historically; live window_list/find_text/observe succeed | `src/tools/index.ts` ll.16-20; `C:\gates\gate-b.txt` B2 PASS; live `scr-0/1/2-mtzj*` today | [VERIFIED LIVE] |
| Safety model | screen_id binding, freshness, recheck before injection, allowlists, no clamping, structured errors | Implemented in `store.ts`/`policy.ts`/`geometry.ts`/`keys.ts`/`input.ps1`; unit + Gate C cover it; live allowlist enforced (see §8) | See §8 table | [VERIFIED LIVE] for core gates; [VERIFIED HISTORICALLY] for full Gate C matrix |
| Perception architecture | find_text/find_element first, observe when visual reasoning genuinely required | Implemented; descriptions enforce ladder; live UIA matches + OCR available | `perception.ts`, `observation.ts`; live `engines_used:["uia"]`, `ocr_available:true` | [VERIFIED LIVE] |
| Video/audio future layer | Future layer | No video/audio code in src (grep negative) | grep CREATED/video/audio/multimodal = none | [ASPIRATIONAL / NOT IMPLEMENTED] |
| Gates A–F | A build+unit, B observation, C negative safety, D real mouse/keyboard, E bounded scripted loop, F model-driven loop | A no PASS artifact; B/C/D/E PASS .txt artifacts; F trace exists but does not meet PASS definition | `C:\gates\gate-b/c/d/e*.txt`; no `gate-a.txt`; trace analysis §12 | [VERIFIED HISTORICALLY] B–E; A [IMPLEMENTED / UNVERIFIED]; F [FAILED] |
| Gate F requirements | model drives + code changed + saved + tests via MCP + model observes result + completion decision + independent verify + zero bypasses | 6/8 met in latest native run; tests-via-MCP missing; independent verify missing | trace `ses_f66403272ffeiaN4UxZ89e3mS9` 25 tool uses, POLICY_DENIED on terminal focus, DONE with caveat | [FAILED] |
| OpenCode integration | native MCP connection, tools visible | Present: `opencode.json` local command `node C:\gates\keyboard\dist\src\index.js`, input true; live calls succeed; trace shows 25 native calls | `opencode.json`; live scr-0/1/2; trace 2026-09-13T07:51–07:54Z | [VERIFIED LIVE] |
| Muse Spark role | Select/construct/act/recover/perceive/complete/verify | Native model (OpenAI-bridged `muse-spark` per trace metadata `openai.itemId`) selected tools, built valid args, acted, recovered from failed first edit (refocus+click+retype), perceived via observe+find_text, completed with caveat; did NOT verify via tests | Trace inputs all valid; DONE text explicitly states tests not run | Partial — see §11 |
| OMP/Muse future role | Workspace ownership, loop/retry/recovery, independent verification | Described in README; no implementation in src | grep OMP/orchestrat in src = none | [ASPIRATIONAL / NOT IMPLEMENTED] |
| Two-window session architecture | Terminal + editor session | Only static PID allowlist per run; no session object; terminal window missing in latest Gate F | `policy.ts` allowedPids; `gate-f-setup.json` vs trace mismatch | [IMPLEMENTED / UNVERIFIED] as static config; session abstraction [ASPIRATIONAL / NOT IMPLEMENTED] |
| Retry/wait architecture | wait primitives + future CREATED…FAILED session states | Primitives exist; session states do not exist in src | `wait.ts`; grep session states negative | Primitives [VERIFIED HISTORICALLY]; session behavior [ASPIRATIONAL / NOT IMPLEMENTED] |
| Verifier architecture | External verifier reruns tests, inspects artifacts+trace, distinguishes claims from facts | Harness-side verification exists in Gate E/worker-harness; no standalone verifier service; native Gate F run had no verify step | `gate-e-devloop.mjs` E5; `worker-harness.mjs` ll.186-204; trace has no verify stage | VERIFIER PARTIAL (see §15) |
| Autonomous loop | Bounded → continuous autonomous development | Bounded scripted loop (Gate E) [VERIFIED HISTORICALLY]; model-driven loop [FAILED]; continuous [ASPIRATIONAL / NOT IMPLEMENTED] | gate-e.txt PASS; trace DONE-caveat | Mixed — see Gates |
| Future multimodal architecture | GLM worker, stronger models, multimodal perception | NIM vision probes document failures; no GLM code; screenshot+UIA/OCR only | `gate-f-perception-result.json`, `gate-f-react-vision-result.json` | [ASPIRATIONAL / NOT IMPLEMENTED] |
| Current roadmap | Milestones 1–8 | No roadmap file; milestones reconstructed in §18 | No milestone code; README "Known limitations" only | [UNKNOWN] as documented plan; assessed in §18 |

---

## 2. Repository audit

### 2.1 Source inventory (WSL, all files verified same hash in Windows copy)

Core (8): `src/index.ts, src/server.ts, src/deps.ts, src/core/{store,policy,geometry,keys,errors,util,result}.ts` (result.ts makes 9th core file — 7 in core/ + deps/server/index).
Tools (6): `src/tools/{index,args,observation,perception,input,wait}.ts`
Backend (2+9): `src/windows-backend/powershell.ts` + 9 PS helpers (`_io,_win32,_state,state,windows,capture,focus,perception,input.ps1`).
Build (1): `scripts/build.mjs` (`rm dist; tsc; copy PS scripts`).
Config: `package.json` (node>=18.19, mcp sdk ^1.12, zod, typescript), `tsconfig.json` (ES2022/Node16 strict), `.env.example` (defaults: input false, no PIDs, 30s age, cache 32, 12MB).

18-file hash comparison WSL vs `C:\gates\keyboard` (package.json, README, tsconfig, all src core/tools/deps/server/index/powershell): **all SAME** (SHA256 match, e.g. observation.ts `77B005F1…4609E` both sides).

### 2.2 Tests inventory

Unit (5 files, 34 `test()` blocks): `tools.test.ts` 12, `geometry.test.ts` 8, `policy.test.ts` 5, `keys.test.ts` 6, `store.test.ts` 3.
Gate scripts (5): `gate-b-observe.mjs, gate-c-negative.mjs, gate-c2-allowlist.mjs, gate-d-notepad.mjs, gate-e-devloop.mjs`.
Probes/ad-hoc (10): `probe-vision-{capture,state,shot,ocr,xcheck,recapture,act}.mjs` (7) + `probe-vision-shot` counted, `probe-exact.mjs`, `mcp-client.mjs`, plus `worker-harness.mjs`, `react-vision-loop.mjs`.
Artifacts in repo (2): `tests/artifacts/gate-f-perception-result.json`, `gate-f-react-vision-result.json` (both NIM-vision failure analyses, truncated 1-line JSON).

### 2.3 Divergence WSL ↔ Windows

- `src/dist` logic: SAME for all compared files. `dist` file listing matches `src` outputs (timestamps 9/12–9/13).
- **Divergence**: `C:\gates\keyboard\` root has 3 Windows-only ad-hoc files absent from WSL source: `diag-terminal.mjs, gate-f-setup.mjs, setup-editor-only.mjs`, plus `find-terminal.mjs`. These are unversioned setup/diag scripts (reproducibility risk — the current Gate F setup path is not in source).
- `C:\gates\` (outside repo) holds ~60 probe/gate artifacts (`probe-*.txt`, `probe-vision*.json`, `gate-*.txt/jsonl`, `worker-*`, `react-*`, `dbg-*.ps1`). Expected as evidence dir, but unversioned and partly UTF-16 (trace) vs UTF-8 mix.
- No VCS: `git status` in `/home/yaser/keyboard` → `fatal: not a git repository`. **No VCS / reproducibility risk** stated explicitly. Do not create Git in this audit.

### 2.4 Build process

`npm run build` = delete dist + `tsc` + copy PS helpers. `npm test` = build + `node --test dist/tests/unit/`. Gate commands `gate:b/c/d/e` each rebuild then run one script. **Build was NOT run today** (would delete/rewrite `dist`, violating read-only). Dist consistency is therefore [VERIFIED HISTORICALLY] via live MCP responses coming from `C:\gates\keyboard\dist\src\index.js` (opencode.json points there; live calls succeed → helpers present).

---

## 3. MCP tool audit (exact, from source — not README)

| Tool | Implemented | Schema (actual zod) | Unit | Windows Live | Safety | Current Evidence |
|---|---|---|---|---|---|---|
| observe | Yes (`observation.ts` ll.8-66) | `target: "screen" \| {monitor:int>=0} \| {window:int} \| {x,y,w:int>0,h:int>0}` default `"screen"`; `format png\|jpeg` d.`png`; `quality 30-95` d80; `max_dimension int>=0` d1924; `include_ui bool` dfalse | Yes (image block, no path, screen_id) | [VERIFIED LIVE] today `scr-2-mtzjx12x` 640x360 + image bytes seen | readOnly true; size cap 12MB; fresh screen_id minted | source + live observe + `gate-b.txt` B3-B7 PASS (historic full) |
| window_list | Yes (ll.68-85) | `{}` (no args) | Indirect (via focus tests) | [VERIFIED LIVE] `scr-0-mtzjwpwc` 10 windows, real PIDs, fg 4523402 | readOnly true; fresh binding | source + live + B10 historic |
| window_focus | Yes (ll.87-118) | `{hwnd:int}` | Yes (POLICY_DENIED before focus; WINDOW_NOT_FOUND no focus) | [VERIFIED HISTORICALLY] (Gate D/E + native trace 2× success + 1× POLICY_DENIED correct); auditor issued no focus (mutation) | Mutation; allowlist BEFORE focus; verify fg==hwnd; fresh sid | source + trace idx24/50 success, idx73 POLICY_DENIED (allowed [16576,15408] vs fg pid 14292) |
| find_text | Yes (`perception.ts` ll.25-48) | `text? \| regex?` exactly-one; `scope foreground\|desktop` d.foreground; `engine auto\|uia\|ocr` d.auto; `limit 1-50` d10 | Yes (binding carries UI state, not match data) | [VERIFIED LIVE] `scr-1-mtzjww9q` 5 UIA matches for math.js, ocr_available true | readOnly; full PerceiveOutcome required to mint sid | source + live + trace 6 calls (incl. empty-result valid) |
| find_element | Yes (ll.50-73) | `name? control_type?(min2)? automation_id? class_name?` ≥1 required; `scope` d.foreground; `limit` d10 | [IMPLEMENTED / UNVERIFIED] (no dedicated unit; covered by shared perceive path) | [VERIFIED HISTORICALLY] trace idx18 empty-result valid | readOnly; same binding rule | source + trace; live not re-probed |
| click | Yes (`input.ts` ll.43-91) | `screen_id?` (optional schema, REQUIRED by description → NO_OBSERVATION if missing); `x,y numbers`; `space image\|desktop\|monitor` d.image; `monitor?`; `button left\|right\|middle` d.left; `count 1\|2` d1 | Yes (NO_OBSERVATION/STALE/POLICY/INVALID_COORD/happy+expect HWND 42; FOREGROUND_CHANGED propagation) | [VERIFIED HISTORICALLY] Gate D 5/5 cycles + Gate E + native trace idx56 success; auditor issued no click | Mutation lock; bind+allowlist+resolvePoint (never clamp)+pre-injection expect (HWND+geometry+monitors_hash) | source + gate-d.txt + trace |
| type | Yes (ll.93-111) | `screen_id?`; `text 1-4000 chars` | Yes (control chars rejected; clipboard_restored flag) | [VERIFIED HISTORICALLY] Gate D/E + trace idx34/63 88-char fix, clipboard_restored true | Paste transport, saves/restores clipboard; rejects control chars (never shortcuts) | source + trace |
| key_press | Yes (ll.113-132) | `screen_id?`; `keys 1-120 chars` | Yes (UNKNOWN_KEY + modifier-only rejected pre-injection, zero input calls; chord bytes verified) | [VERIFIED HISTORICALLY] Gate D/E + trace 4× (ctrl+a, ctrl+s ×2) | Whole-chord validation pre-injection; UNKNOWN_KEY sends nothing | source + trace |
| scroll | Yes (ll.134-160) | `screen_id?`; `direction up\|down`; `amount 1-50` d3; `x,y?,space?,monitor?` (both-or-neither + monitor requires index) | [IMPLEMENTED / UNVERIFIED] (no dedicated unit; geometry shared) | [VERIFIED HISTORICALLY] Gate D scroll+wait_for_change (TIMEOUT accepted as non-error) | Same mutation gate; cursor-position allowed | source + gate-d script ll.92-95 |
| wait | Yes (`wait.ts` ll.33-42) | `duration_ms 0-30000` | [IMPLEMENTED / UNVERIFIED] (no unit; trivial sleep) | [VERIFIED HISTORICALLY] used in D/E harnesses | readOnly; bounded; never holds mutation lock | source + gate scripts |
| wait_for_text | Yes (ll.44-82) | `text?\|regex?` exactly-one; `scope` d.foreground; `engine` d.auto; `timeout 250-60000` d10000; `poll 200-2000` d500; `absent` dfalse; `must_appear_first` dfalse | Yes (success + honest TIMEOUT; absent+must_appear_first never-seen → TIMEOUT) | [VERIFIED HISTORICALLY] Gate D marker waits; Gate E E2b/E4b probes logged `found=false` (honest negative, console text not in UIA) | TIMEOUT never false-success | source + unit + gate-d/e |
| wait_for_change | Yes (ll.84-141) | `screen_id?`; `timeout` d10000; `poll` d500; `threshold 0.01-0.9` d0.1; `settle 0-5000` d0 | Yes (delta detected; static → TIMEOUT) | [VERIFIED HISTORICALLY] Gate D scroll step | 8x8 thumbprint + fg/geo change; settle polling | source + unit |

All 12 present. No extra tools. `tools/list` B2 historic PASS; live `window_list` proves server built from same 12-tool registry (opencode `MCP computer-control Connected`).

---

## 4. OBSERVE CONTRACT — CRITICAL

Schema (source of truth, `observation.ts` ll.8-19):

```ts
target: "screen" | {monitor:number} | {window:number} | {x,y,w,h}  // default "screen"
```

- `{}` → default `"screen"` [VERIFIED LIVE] (auditor `observe(max_dimension:640,target:"screen")`; native trace 5× `input:{}` all completed).
- `{"target":"screen"}` [VERIFIED LIVE] (auditor call today).
- `{"target":{"monitor":0}}` [IMPLEMENTED / UNVERIFIED] live (code path in `capture.ps1` ll.24-27 + TS schema; no live call today; historic gates used screen/window only).
- `{"target":{"window":123456}}` object form [VERIFIED HISTORICALLY] (Gate D `observe({target:{window:np.hwnd}})` + Gate E same; `capture.ps1` ll.28-36 WindowInfo path; TS object schema).
- Rectangle `{x,y,w,h}` [IMPLEMENTED / UNVERIFIED] (schema + `capture.ps1` ll.37-42 outside-virtual-screen → INVALID_ARGUMENT, never clamp; no evidence of live use in traces reviewed).
- Nested objects are **objects, not strings** in both TS (`z.object`) and PS (`$t.monitor/$t.window/$t.x`). Stringified form `{"target":"{\"window\":123456}"}` would hit `INVALID_ARGUMENT` (`string target must be 'screen'`, `capture.ps1` l.23) — correct rejection, never parsed as JSON. No code path `JSON.parse`s a string target.
- Previously observed agent failure (stringified target): **not observed in the current native Muse trace** — all 5 observes used `{}`; all mutations used proper string `screen_id`, numeric `x/y`, string `keys`/`text`. The ReAct NIM harness exhibited a *different* defect (copying example `scr-9-abc12-3456` verbatim, `gate-f-react-vision-result.json`), not the stringified-target defect.
- Current defect status: [UNKNOWN] for today's Muse Spark (construct never exercised — model never attempted window/rect targets, so neither correct nor incorrect object-nesting was demonstrated). No patch was applied (audit only). Zod boundary correctly converts malformed input to `INVALID_ARGUMENT`, never `INTERNAL_ERROR` (`args.ts`).

---

## 5. Safety audit (each item independently)

| Safety item | Implementation | Evidence | Live verification | Historical verification | Current risk |
|---|---|---|---|---|---|
| screen_id binding | `store.require()` + `bindMutation` + `bindPerceptionOutcome` (full outcome only) | `store.ts` ll.61-73; `input.ts` ll.25-31; `deps.ts` ll.101-107 | [VERIFIED LIVE] fresh `scr-0/1/2` minted on each read | unit + Gate C C1/C2 + trace (all mutations carried fresh sid) | Low — binding enforced at type + runtime |
| Observation freshness | `maxAgeMs` default 30000, min 1000; age = now-timestamp | `policy.ts` ll.34-35; `store.ts` ll.68-71 | Live `max_observation_age_ms:30000` in observe output | Gate C C9 (900ms window → STALE_SCREEN after 1200ms) | Low |
| NO_OBSERVATION | Missing/blank sid → NO_OBSERVATION + hint | `store.ts` ll.62-64; `input.ts` ll.25 | Not re-probed live (would require a mutation attempt — refused) | Unit + C1 PASS | Low |
| STALE_SCREEN | Unknown/evicted/expired/geo-changed → STALE_SCREEN | `store.ts` ll.66-71; `input.ps1` ll.18-35 | Not re-probed live | Unit + C2/C9 + ReAct salvaged call correctly rejected | Low |
| Foreground validation | TS allowlist + `expect.foreground_hwnd`; PS re-checks `Get-UiState` fg HWND immediately before SendInput; geometry+monitors_hash also checked | `input.ts` ll.33-41; `input.ps1` ll.7-36 | [VERIFIED LIVE] indirectly: trace idx73 POLICY_DENIED shows fg check data; live fg consistent across window_list+observe (4523402) | Gate C C10 (harness-side notepad steal → FOREGROUND_CHANGED, input NOT sent) | Low — the one gate that must never fail |
| STALE_SCREEN (geometry) | virtual_screen + monitors_hash compared pre-injection | `util.ts` monitorsHash; `input.ps1` ll.17-35 | [UNKNOWN] live (no geometry change today) | C10-adjacent; unit thumbprint delta | Low |
| FOREGROUND_CHANGED | HWND mismatch → error, input NOT sent | `input.ps1` ll.9-16 | [VERIFIED HISTORICALLY] (not re-triggered today — would need focus theft) | C10 PASS; unit propagation test | Low |
| Pre-injection recheck | Second check inside `input.ps1` after TS gate (atomic) | `input.ps1` ll.7-36 comment "ATOMIC PRE-INJECTION VALIDATION" | Code present; live path exercised by trace successes (expect HWND passed) | C10 proves recheck fires | Low |
| HWND identity | Numeric HWND compared as `[long]`; focus verifies `foreground.hwnd === requested` | `observation.ts` ll.108-110; `input.ps1` l.9 | Trace focus 460386 verified twice | Gate D/E focus steps | Low |
| PID ownership | `GetWindowThreadProcessId` (never `$PID`); window_list exposes real pid | README ll.46-47; `windows.ps1` via `_win32.ps1`; Gate B B8 same-PID check | Live PIDs >4, Notepad 15408 stable across trace→audit | B8 PASS | Low |
| PID allowlist | `COMPUTER_CONTROL_ALLOWED_PIDS` CSV → Set; `assertWindowAllowed` on bind + on focus (before+after) | `policy.ts` ll.29-31/49-53; `observation.ts` ll.104-111 | [VERIFIED LIVE] enforcement seen in trace idx73 (allowed [16576,15408] denied fg 14292); auditor's own server has NO allowlist (open — see risk) | Unit + gate-d/e gating + C11 | **Medium**: auditor/OpenCode default config has no ALLOWED_PIDS (open scope). Per-run gated servers are correctly scoped, but the persistent OpenCode MCP is allowlist-free. |
| Title allowlist | `COMPUTER_CONTROL_ALLOWED_WINDOW_TITLES` substring case-insensitive | `policy.ts` ll.32-33/54-56 | [IMPLEMENTED / UNVERIFIED] live (no titles configured) | `policy.test.ts` case-insensitive test | Low (unused in practice) |
| Coordinate validation | `resolvePoint`: image bounds, monitor bounds, on-monitor desktop; never clamps; non-finite rejected; imageless binding image-space rejected | `geometry.ts` ll.44-71; `input.ps1` ll.41-50 second check | Not re-probed live | Unit (8 geometry tests) + C5/C6 PASS | Low |
| Keyboard validation | `parseChord` whole-chord pre-validation; `assertTypableText` rejects control chars | `keys.ts` ll.49-72 | Not re-probed live | Unit + C3/C4 PASS | Low |
| Mutation policy | `assertInputEnabled`; observe-only default false; focus is mutation | `policy.ts` ll.43-47; `observation.ts` l.94; `server.ts` readOnly annotations | Live OpenCode server input enabled (mutations would be allowed — auditor issued none) | C11/C11b PASS | **Medium**: default-true in OpenCode config widens persistent scope (see §9) |
| Mutation lock | `withMutationLock` for non-readOnly; reads/waits concurrent | `server.ts` ll.17-22; `util.ts` ll.12-22 | Code present; live concurrency not stress-tested | Unit (60s wait never starves observe — design; no deadlock report) | Low |
| Structured errors | 12 codes; `errorResult` envelope `{ok:false,error:{code,message,details,hint}}` + `isError:true`; PS codes normalized, never INTERNAL_ERROR for client errors | `errors.ts`; `result.ts` ll.33-45 | Live errors not triggered; trace error idx73 is correctly structured POLICY_DENIED | Unit errOf paths + all Gate C codes | Low |

**Was safety ever weakened for a model failure?** No evidence. `withMutationLock` narrowing (was: every tool; now: mutations only) is documented as a starvation fix with comment, not a model accommodation. `type` paste transport (vs SendInput stream) is a reliability fix with clipboard-restore flag, not a policy weakening. The ReAct salvaged-call was *rejected* (STALE_SCREEN), not accommodated. No `POLICY_DENIED` bypass, no clamping, no timeout reinterpretation found. **No high-severity divergence.**

---

## 6. Window scope audit (intended: AUTHORIZED orchestration+worker windows; DENIED everything else)

| Scope mechanism | Implementation | Evidence | Assessment |
|---|---|---|---|
| PID allowlisting | Static env CSV per server instance | `policy.ts`; Gate D/E/worker `ALLOWED_PIDS: termPid,notePid`; native trace allowed `[16576,15408]` | Works per-instance; [VERIFIED HISTORICALLY] + live enforcement (idx73). BUT it is **static environment configuration**, not a session abstraction (see below). |
| HWND identity | Verified on focus; bound via expect HWND | `observation.ts` ll.108-110; `input.ps1` | [VERIFIED HISTORICALLY] |
| Foreground restriction | Mutations bind to observed fg; pre-injection recheck refuses on change | `input.ts` + `input.ps1` | [VERIFIED HISTORICALLY] (C10) |
| Title allowlist | Substring match | `policy.ts` | [IMPLEMENTED / UNVERIFIED] in practice |
| Session-level authorization | None — no session object, no per-model scopes, no workspace restriction in src | grep session/CREATED/... negative; `Policy` has only global sets | [ASPIRATIONAL / NOT IMPLEMENTED] |
| Per-model window scopes | None | Same | [ASPIRATIONAL / NOT IMPLEMENTED] |
| Two-window restriction | Convention only (harness passes two PIDs); MCP cannot express "exactly these two and only for this run" beyond env | Gate D/E scripts; `setup-editor-only.mjs` assumes persistent terminal + new notepad | Convention, not abstraction |
| Workspace restriction | None in MCP (no fs tools — good — but also no path scoping; scoping lives in harness prompts) | src has no fs; `worker-harness.mjs` SYSTEM prompt names `wdir` | Prompt-level only |

**Do not treat a populated PID allowlist from one test as proof of a reusable session abstraction.** Correct: each PASS (D/E/trace) used a fresh per-run PID pair. There is no session token, no expiry beyond observation age, no per-model partition, no OMP-owned workspace binding. The persistent OpenCode MCP (`opencode.json` env: input true, **no ALLOWED_PIDS**) is currently **unscoped** — any model call can target any window the server can see. Per-run gated harnesses are correctly scoped, but the daily-driver config is open. Risk: P1 (see §21).

---

## 7. Perception audit

| Layer | Claim | Evidence | Status |
|---|---|---|---|
| L1 Screenshot capture works | `capture.ps1` CopyFromScreen + DPI-aware + thumbprint | Live 640x360 PNG today; Gate B B4 PNG magic; probe-vision.json 141152 bytes | [VERIFIED LIVE] |
| L2 MCP returns real image | Native image content block, never path | Live image block rendered in this session; unit "no path"; B3/B9 | [VERIFIED LIVE] |
| L3 OpenCode/Muse receives image | Trace observe outputs + live auditor sees pixels | Auditor visually confirmed screenshot (terminal+taskbar); trace `has_image_str` in 5 observes | [VERIFIED LIVE] |
| L4 Muse Spark interprets pixels | Native model described Notepad BUG line, Ln/char counts, File-menu focus state, opencode window covering screen | DONE text ll.9/13/22 + 6 commentary texts; perception probes: salient text read OK (terminal echo, titles) | [VERIFIED HISTORICALLY] (today's trace, not re-run by auditor) — salient text yes; fine detail mixed |
| L5 Model uses vision to choose action | After observe-13 showed stale BUG + File-menu focus, model refocused, clicked editor (1145,182), retyped, saved; observe-22 confirmed fix | Trace idx40→50→56→69 sequence + DONE narrative | [VERIFIED HISTORICALLY] for this run |
| L6 Reliable enough for safe control | NIM llama-3.2-11b-vision misattributes regions, confabulates strings (ChatGPT-button quote; session text as Notepad doc), fails forced-choice NO/NO/YES; ReAct protocol never yields exactly-one-JSON; native Muse succeeded once for edit but never ran tests | `gate-f-perception-result.json` blocker_detail; `gate-f-react-vision-result.json` classification_reason | [FAILED] for NIM vision; [UNKNOWN] for native Muse reliability (n=1 edit success, no test-run, no repeat) — NOT proven safe for unsupervised control |

Structured perception:

- UIA [VERIFIED LIVE] (5 matches, Window/TabItem/Text control types, bounds+center desktop-absolute).
- OCR availability flag [VERIFIED LIVE] (`ocr_available:true`); OCR fallback path in `perception.ps1` ll.183-199 (MaxImageDimension tiling). Live engines_used `["uia"]` (OCR not needed when UIA hits).
- find_text / find_element [VERIFIED LIVE] / [VERIFIED HISTORICALLY] respectively.
- **Terminal text visibility gap** [VERIFIED HISTORICALLY]: Gate E E2b/E4b `found=false` for `FAIL: add(2,3)` and `ALL TESTS PASSED` via `wait_for_text` (file-verified instead). Console host text is not reliably in UIA/OCR.
- **Notepad/editor doc body gap** [VERIFIED HISTORICALLY]: `find_text "return a + b"` returned only the `Document` control (`RichEditD2DPT` bounding whole editor), not the text line; doc-body queries return the Text-editor control. First edit's `find_text return a+b` empty despite typed content (focus was on File menu). ValuePattern matches report whole-control bounds (README known limitation). So "edit verified via find_text" is control-presence, not content-proof; Gate D/E correctly fell back to disk reads + observe.

---

## 8. Muse Spark / OpenCode audit

OpenCode MCP config (`C:\Users\yaser\.config\opencode\opencode.json`): local `node C:\gates\keyboard\dist\src\index.js`, enabled, timeout 60000, env input true + log error, **no allowlist**. Native connection [VERIFIED LIVE] (auditor calls + `Connected` in screenshot + trace 25 calls, session `ses_f66403272ffeiaN4UxZ89e3mS9`).

Model actually used: latest Gate F = native OpenCode model with `openai.itemId` metadata (Muse Spark path per operator setup; trace has no explicit model-name field — model string [UNKNOWN], provider bridge OpenAI-compatible). Earlier legs: `meta/llama-3.2-11b-vision-instruct` and `deepseek-ai/deepseek-v4-flash-0731` via NIM (`worker-harness.mjs`, `react-vision-loop.mjs`, react summary `model` field).

| Capability | Native Muse (today trace) | NIM vision/DeepSeek (historic probes) |
|---|---|---|
| Select tools | Yes — window_list→observe→find_text/element→focus→key/type/click sequence, 25 calls | [FAILED]: tools+image HTTP 400 both orderings; tools-only 200 (mutually exclusive on NIM endpoint) |
| Construct valid arguments | Yes — all inputs valid JSON, correct sid chaining, `click(space:image,x,y)`, `keys: ctrl+a/ctrl+s` | [FAILED]: prose plans, literal enum/example copies (`scr-9-abc12-3456`), 3 JSON objects in one reply, invented delay arg |
| Act | Yes — 24/25 completed (1 correct POLICY_DENIED refusal) | [FAILED]: no valid model action ever reached successful execution |
| Recover | Yes — detected stale edit (observe-13 + empty find_text), refocused + clicked editor + retyped | No — false `achieved`/`seen` claims with zero execution |
| Perceive | Yes — used observe + find_text to diagnose File-menu focus and confirm 88-char fix | Partial — salient text yes, region attribution failure (session text reported as Notepad doc/title) |
| Complete | Caveated DONE (explicitly states tests not run, terminal missing) — honest, not false | False DONE/achieved claims (ReAct) |
| Verify | No — did not run tests, no independent check | No |

Session persistence: single session `ses_...` across 26 steps / ~3.5 min [VERIFIED HISTORICALLY]. Provider stalls: NIM transport timeouts (`worker-run.txt` `model unreachable after 3 attempts`; react transport_retry events) [VERIFIED HISTORICALLY]; native run had no stall.

---

## 9. Gate audit (canonical matrix)

| Gate | Current Status | Evidence Type | Evidence | Limitation |
|---|---|---|---|---|
| A Build + unit | [IMPLEMENTED / UNVERIFIED] | Code + test files, no PASS artifact | 34 tests in 5 files; `npm test` = build+`node --test`; no `gate-a.txt`; build NOT run today (read-only) | Unit outcome unproven today; dist freshness assumed from live server working |
| B Windows observation | [VERIFIED HISTORICALLY] (+ partial [VERIFIED LIVE]) | `C:\gates\gate-b.txt` ALL PASS (B1-B10) + live window_list/find_text/observe today | B4 PNG magic, B8 no-$PID-bug, B9 no path; live scr-0/1/2 confirms same properties | Full 10-check matrix not re-run today |
| C Negative safety | [VERIFIED HISTORICALLY] | `C:\gates\gate-c.txt` ALL PASS (C1-C11b, zero real input) | C10 focus-steal→FOREGROUND_CHANGED; C9 staleness; C11 observe-only POLICY_DENIED | Not re-run today (would need focus theft + mutations) |
| D Real mouse/keyboard | [VERIFIED HISTORICALLY] | `C:\gates\gate-d.txt` 5/5 VERIFIED + PASS D1/D2 | Owned PID allowlist, click/type/ctrl+s/disk-check/scroll per cycle; `ownedProcess:false` (shared Notepad, tab-gated) | Single-instance Notepad caveat; scroll→change TIMEOUT accepted |
| E Bounded scripted loop | [VERIFIED HISTORICALLY] | `gate-e.txt` + `gate-e-checkpoints.jsonl` (10 ckpts) + `gate-e-result.json` PASS | Harness-as-Muse drove terminal+Notepad via MCP; E2 FAIL file-verified; E3 disk-match; E4 ALL TESTS PASSED file-verified; E5 harness-side `node run.js` green | Console-visibility probes E2b/E4b `found=false` (UIA gap worked around via files); harness (not model) drove |
| F Model-driven loop | [FAILED] | `gate-f-muse-native-trace.jsonl` (84 lines, UTF-16, ses_f664…, 2026-09-13T07:51–07:54Z) + DONE text + `gate-f-setup.json` (newer, mismatched) | 25 native tool calls; fix typed+saved (88 chars); terminal focus POLICY_DENIED; tests never run; no independent verify | See §10 trace; strict 8-conjunct definition not met (6/8) |

Acceptance criteria applied strictly per prompt §12. No relaxation.

---

## 10. Latest Gate F audit (newest run with model evidence)

- runTag: trace dir references `gatef-1789285834508` (math.js marker) + terminal tag `cc-gatef-1789285834509`; `C:\gates\gate-f-setup.json` holds a NEWER setup `gatef-1789287070614` (dir `gatef-native-ZQw6xh`, term 4523402/16132 = auditor's current terminal) written 13:41 local — **after** the trace (13:24 file time). The trace's setup (dir `gatef-native-oQ0CfQ`, term HWND 1115720/PID 14292, allowed `[16576,15408]`) no longer matches `gate-f-setup.json`. Newest *completed model run* = trace; newest *setup* = editor-only, awaiting a run.
- Time: 2026-09-13T07:51:25Z → 07:54:53Z UTC (≈3m28s, 26 steps).
- OpenCode session ID: `ses_f66403272ffeiaN4UxZ89e3mS9`.
- Model/provider: native OpenCode path (trace `openai.itemId` metadata; exact model string not in trace → [UNKNOWN]); earlier NIM legs: `meta/llama-3.2-11b-vision-instruct`, `deepseek-ai/deepseek-v4-flash-0731`.
- Setup status: terminal `cc-gatef-*` never appeared as window (allowed PID 16576 absent from all 3 window_lists); Notepad 460386/15408 found; persistent WindowsTerminal 1115720 present but unowned.
- Terminal HWND/PID: expected 16576 (no window); actual foreground terminal 1115720/14292 (shared, denied).
- Editor HWND/PID: 460386/15408 (stable — same in today's live audit).
- Last model event: DONE text (1702 chars) with explicit caveat.
- Last MCP event: `find_text "return a + b"` → UIA Document match (control-presence, not content-proof).
- Last checkpoint/artifact: trace itself (no checkpoints.jsonl for F; `gate-f-setup.json` overwritten by later editor-only setup).
- Task started: yes. Completed: partially (edit saved; tests not run). Tests ran: no (via MCP). Independent verification ran: no. Safety bypassed: no (POLICY_DENIED respected, zero bypasses).

Execution trace:

```
SETUP            ✓ (editor found; terminal tag never materialized — partial)
MODEL START      ✓ (ses_f664… step_start)
OBSERVE          ✓ (5 observes, fresh sids; saw BUG line + File-menu state)
REASON           ✓ (diagnosed stale edit, chose refocus+click+retype)
ACT              ✓ (focus×2, ctrl+a/type/ctrl+s ×2, click 1145,182 — 24/25 ok)
SAVE             ✓ (observe scr-21 shows 88-char fixed file; caveat: UIA text-proof is control-only)
RUN TESTS        ✗ (window_focus 1115720 → POLICY_DENIED; owned 16576 has no window)
OBSERVE RESULT   ? (editor result observed; test result never existed)
COMPLETE         ? (honest caveated DONE, not a verified DONE)
INDEPENDENT VERIFY ✗ (no harness rerun, no disk check in trace)
```

Verdict: **Gate F FAIL** (6/8 conjuncts; missing tests-via-MCP + independent verify). Zero bypasses is the one unambiguously positive safety signal.

---

## 11. Environment / window-lifetime audit (diagnosis only, no launcher change)

- Launch pattern: `cmd.exe /c start "title" cmd /K title <tag>` (fire-and-forget; `unref()`), then read-only discovery by unique title; same for `notepad.exe <path>`. Launcher (`cmd /c`) exits at once by design.
- Child owns visible HWND: yes — `window_list` PID comes from `GetWindowThreadProcessId` on the HWND (never launcher `$PID`/stub pid). Gate D comment documents Win11 `notepad.exe` Store-alias stub exiting (child.pid ≠ owner) and compensates via discovery.
- Recorded PID owns real window: for Notepad yes (15408 stable across trace→audit, 460386). For disposable terminals no — allowed 16576 never appears; shared WindowsTerminal 14292/1115720 is a different process. The `cmd /c start` child either never hosted the titled tab (WT multiplexes tabs into one process) or exited.
- Terminal survives unattended: [FAILED] for disposable pattern (this run + editor-only workaround existence). `find-terminal.mjs` (T+0/T+35s persistence check) and `diag-terminal.mjs` (CIM parent map + 3×15s liveness + taskkill cleanup) exist but have **no result artifacts** → [UNKNOWN] whether they ever passed.
- Console lifecycle responsible: likely — WT single-process multi-tab model means per-run `cmd /c start` titles do not yield distinct PIDs; Gate E's `requireOwnTab` (refuse injection if active tab title changed) already treats the WT window as shared. `setup-editor-only.mjs` (never spawns/kills terminal; discovers the single persistent WT window) is the de-facto acknowledgment.
- WT/PowerShell vs disposable `cmd /c`: evidence favors persistent-WT + title-guard over disposable launchers. No WMIC used; `diag-terminal.mjs` uses `Get-CimInstance Win32_Process` (CIM, not WMIC assumption) — parent info **available** via that path, but no diag output was captured, so chain-of-ownership for 16576 is [UNKNOWN].
- Not modified. No process killed, no window closed by auditor.

---

## 12. Independent verification audit

- Can worker declare DONE without external verification? **Yes** — native DONE was accepted into trace with no gate; ReAct legs emitted false `achieved` verdicts. No MCP-side DONE guard exists (correct — MCP is capability-only).
- Does external verifier rerun tests? Gate E yes (`node run.js` in harness, E5); worker-harness yes (ll.191-198, `VERIFIED COMPLETE` only if done+disk+tests); native Gate F run **no**.
- Does it inspect actual artifacts? Gate E yes (disk `=== fixed`, out1/out2 files); worker-harness yes (`math.includes("return a + b")` + marker + stdout).
- Does it inspect MCP trace? No — verification is file/process-based, not trace-auditing. Trace is persisted but not machine-checked.
- Can it distinguish model claims from facts? Gate E/worker-harness yes (verdict independent of DONE; ReAct summary `verified:false` despite `achieved` claim). Native run had no verifier, so its honest caveat is the only guard.

Classification: **VERIFIER PARTIAL**. Strong pattern exists in harnesses (Gate E = strong for scripted loop), but there is no enforced boundary for model runs — the newest Gate F completed without any verification step. Not STRONG (not mandatory/automatic), not ABSENT (proven pattern + artifacts).

---

## 13. Wait / retry / recovery audit

Existing generic primitives: `wait` (bounded sleep ≤30s), `wait_for_text` (poll UIA→OCR, honest TIMEOUT, absent+must_appear_first), `wait_for_change` (8x8 thumbprint + fg/geo, settle). [VERIFIED HISTORICALLY] (unit + D/E usage).

Future/session-level `CREATED/SUBMITTED/ACCEPTED/GENERATING/COMPLETED/REJECTED/TIMED_OUT/RETRYING/FAILED`: **none in src** (grep negative) → [ASPIRATIONAL / NOT IMPLEMENTED].

- HTTP/network retry ≠ agent action retry. Transport retries exist in harnesses only (`worker-harness` 3×90s NIM calls; `react-vision-loop` 3×120s + json_repair 1×). These are correctly labeled transport resilience, never fabricated MCP actions.
- Agent action retry: no framework primitive. Gate E has one bounded harness retype + `requireOwnTab` refusals; native model self-retried (focus→click→retype) via reasoning, not framework. So session-level retry/recovery: [ASPIRATIONAL / NOT IMPLEMENTED].

---

## 14. Reproducibility audit

- Git: **No VCS / reproducibility risk** (`fatal: not a git repository`). Do not create Git in audit.
- WSL↔Windows hashes: 18/18 compared source files SAME. `dist` listing consistent; live server runs from Windows `dist` (helpers present — live calls succeed; `selfCheck` would exit(1) otherwise).
- PowerShell helpers: all 9 present both sides (compare-object empty).
- Test script divergence: WSL `tests/scripts` (16 files) vs Windows root ad-hoc `diag-terminal/gate-f-setup/setup-editor-only/find-terminal.mjs` (4 files, not in source). Current Gate F setup path is unversioned.
- Ad-hoc probes/temp: `C:\gates\probe-*` (~40 files), `probe-vision*.json` (85–347KB), `gatef-native-*` Temp dirs (one in DONE path), `cc-visionprobe-*`, `cc-worker-*`, `cc-gate-e-*` (deleted on success per finally). Evidence-rich but unversioned.
- OpenCode config: present (`opencode.json`, input true, no allowlist). WSL `~/.config/opencode` absent (Windows-only setup).
- Env/secrets (values never exposed): `.env` absent both sides; process env has no `COMPUTER_CONTROL_*` (except `COMPUTERNAME`) and no `NIM*/GLM*/DEEPSEEK/OPENAI*` keys in auditor env — consistent with `worker-run.txt` `model unreachable` (no key) and NIM 400/stall history. `opencode.json` carries only `INPUT_ENABLED+LOG` (no secrets). Classification: credentials **absent/environment-driven**, expected for NIM legs; native path needs none.

---

## 15. Blueprint roadmap audit (8 milestones from prompt §18; no roadmap file exists)

| Milestone | Classification | Why |
|---|---|---|
| M1 Close Gate F | **BLOCKED** | Editor half proven (typed+saved+observed, n=1); terminal-run half blocked by window lifetime (owned PID has no window → POLICY_DENIED correct). Strict 8-conjunct FAIL. |
| M2 Production worker/session adapter | **NOT STARTED** | Only ad-hoc harnesses (`worker-harness`, `react-vision-loop`, `gate-e-devloop`); no reusable adapter/service. |
| M3 Session-scoped computer control | **NOT STARTED** | Static env PIDs only; no session token/scope/workspace binding (see §6). Persistent OpenCode MCP unscoped. |
| M4 Recovery/retry | **NOT STARTED** | Primitives exist; no session retry/recovery framework (see §13). |
| M5 OMP/Muse orchestration | **NOT STARTED** | README describes; zero src code. |
| M6 Stronger worker models / GLM | **BLOCKED** | NIM vision path failed (400 tools+image; misattribution; protocol failure); native Muse edit works once but full loop unproven; no GLM code. |
| M7 Multimodal perception | **NOT STARTED** (vision sub-layers 1-3 done) | Screenshot+UIA/OCR work; video/audio absent; L6 reliability unproven. |
| M8 Continuous autonomous development | **NOT STARTED** | Bounded scripted loop only (Gate E). |

No milestone is DONE. Nothing is SUPERSEDED (NIM/DeepSeek are diagnostic history, explicitly not current path unless new evidence proves otherwise — none does).

---

## 16. 🟦 CURRENT POSITION

**What has been conclusively demonstrated:**
- 12-tool MCP builds from clean source; WSL↔Windows sources identical; Windows runtime serves native OpenCode calls (window_list/find_text/observe [VERIFIED LIVE] today).
- Safety core holds: screen_id binding, freshness, allowlist-before-focus, foreground+geometry pre-injection recheck, never-clamp coordinates, whole-chord key validation, 12 structured error codes — unit-covered and Gate C ALL PASS historically, with one correct live POLICY_DENIED refusal in the newest trace.
- Bounded automation works without a model: Gate B (observation), Gate D (5/5 real Notepad cycles), Gate E (scripted dev loop: MCP-typed FAIL → edit → MCP-typed ALL TESTS PASSED → harness-side green) [VERIFIED HISTORICALLY].
- A native model can drive the MCP safely for the *edit half*: 25 valid calls, recovery from a stale edit, 88-char fix saved and observed, honest caveated DONE, zero bypasses (today's trace).

**What is currently blocked:**
- Gate F full loop: the harness-owned terminal never appears as a window (allowed PID 16576 absent; shared WT 14292 correctly denied). Tests cannot be run through the MCP within the allowlist. Single `cmd /c start` disposable-terminal pattern vs WT single-process tab model is the prime suspect. Editor-only setup now exists as workaround but no model run has yet used it end-to-end.

**What is not yet started:**
- Session-scoped authorization, worker/session adapter, retry/recovery framework, OMP/Muse orchestration, GLM/stronger-model integration, video/audio, continuous autonomy, canonical blueprint + VCS. NIM/DeepSeek vision is diagnostic history, not a path.

**Exactly which blueprint milestone the project is on:** M1 — Close Gate F (edit half done once, test-run half blocked). Nothing beyond M1 has started.

**Is the marker in PROJECT_BLUEPRINT.md still accurate?** There is no blueprint file and therefore no marker to be accurate. **MARKER NEEDS UPDATE** — recreate `PROJECT_BLUEPRINT.md` with the position above as the new 🟦 CURRENT POSITION; do not backdate a PASS.

---

## 17. Architecture integrity check

Boundary `Reasoning/orchestration ≠ Computer capability ≠ Windows backend ≠ Independent verification` is **preserved**:

- MCP (`src`) has no provider/model/dev-loop/project-ownership code (grep NIM/GLM/llama/provider negative; no fs project tools; no DONE/verdict logic).
- Windows backend (`powershell.ts` + 9 PS scripts) is transport + Win32/UIA/OCR only; PS error codes normalized, never interpreted as task states.
- Orchestration/dev-loop logic lives in `tests/scripts` harnesses (expected — they are test drivers, not shipped MCP). No orchestration buried in MCP.
- Verifier is harness-side and post-cutoff (`worker-harness` cuts model off before `readFileSync+node run.js`; Gate E E5) — not inside the worker. Native run's missing verify is an omission of that run, not an architectural leak.
- Leakage noted (minor): Windows-only setup scripts (`gate-f-setup.mjs`, `setup-editor-only.mjs`) encode orchestration choices (persistent-terminal discovery) outside versioned source — process risk, not a boundary violation. No hidden direct filesystem access in MCP (only `.env` load + PS spawn). No direct OS automation bypass (all input via gated `input.ps1`).

---

## 18. Final risk register

| Priority | Risk | Evidence | Impact | Recommended Action |
|---|---|---|---|---|
| P0 | No VCS — no history, no blame, no reproducible checkout | `fatal: not a git repository`; 3+ unversioned setup scripts drive current Gate F | Blocks safe progression; any edit is unreviewable | Init git + commit WSL source + gate scripts (explicit operator approval; outside audit) |
| P0 | Canonical blueprint missing — requirements/marker unverifiable | `Test-Path` False both locations; grep finds no marker | Team cannot agree on DONE; Gate F PASS criteria float | Recreate `PROJECT_BLUEPRINT.md` from this audit (§16) as the single source of truth |
| P1 | Disposable terminal never yields a window → Gate F test-run impossible | Trace allowed [16576,15408] vs windows (no 16576); DONE caveat; `setup-editor-only.mjs` workaround unused end-to-end | Blocks M1; every F run fails at RUN TESTS | Adopt persistent-terminal + `requireOwnTab` pattern for Gate F; retire `cmd /c start` per-run terminals (one concrete change — see §19) |
| P1 | Persistent OpenCode MCP unscoped (input true, no ALLOWED_PIDS) | `opencode.json` env; live fg 4523402 allowed by default | Any model call can target any window (Chrome/WhatsApp/Rainmeter visible) | Scope daily-driver config (title-substring or PID workflow) or document accepted open-scope with operator consent |
| P1 | Terminal text + Notepad body not reliably perceivable via UIA/OCR | Gate E E2b/E4b `found=false`; `return a+b` → Document-control only; perception-result.json | Model cannot self-verify tests/edits via MCP reads; forces file bypasses | Define verification to use MCP-visible signals + harness disk checks explicitly; do not claim find_text content-proof |
| P2 | Single-instance Notepad tab confusion (foreign tabs in shared process) | Gate D `ownedProcess:false`; E `runTag` tab-guard + re-open-by-path | Typing into wrong tab worse than loud failure | Keep runTag-marker guard + pre-existing-PID snapshot in every editor run (already pattern — formalize) |
| P2 | 3 unversioned Windows setup scripts diverge from source | `C:\gates\keyboard\*.mjs` absent from WSL | Next engineer cannot reproduce current setup | Move setup/diag scripts into `tests/scripts` + version them |
| P2 | Verifier optional — model DONE without check possible | Native DONE with no verify; no DONE guard (by design) | False-complete risk if caveat ever missing | Make harness `VERIFIED COMPLETE` (done+disk+tests) mandatory for every F attempt; refuse PASS otherwise |
| P3 | Timestamps far-future epoch (1789… = 2026-09-13Z) + mixed UTF-16/UTF-8 artifacts | Trace UTF-16 BOM, `timestamp_iso 2026-09-13T07:5xZ`; system clock assumed | Confuses forensics across machines | Document Windows clock + artifact encodings in blueprint |
| P3 | No drag primitive; 8x8 thumbprint insensitive to glyph changes; spawn-per-call latency | README limitations; Gate D comment on wait_for_change vs typing | Minor capability gaps, correctly documented | Track as M7 hardening, not M1 blockers |

No risk inflated without evidence. Safety-weakening risk explicitly checked: none found.

---

## 19. Final executive summary

**CURRENT MATURITY:** BOUNDED SCRIPTED AUTOMATION WITH ONE HONEST NATIVE MODEL EDIT — not yet MODEL-DRIVEN VERIFIED DEVELOPMENT. Gate E proves a harness can drive the full loop through the MCP; today's native trace proves a model can drive the edit half safely; no run proves a model driving the *full* loop with tests + independent verification.

**WHAT DEFINITELY WORKS:** The 12-tool MCP is real, scoped-per-run, and safe: live window_list/find_text/observe return fresh screen_ids with true PIDs and PNG bytes; negative safety (NO_OBSERVATION/STALE/FOREGROUND_CHANGED/POLICY_DENIED/INVALID_COORDINATE/UNKNOWN_KEY/TIMEOUT) passes historically with zero real input; scripted Notepad cycles (5/5) and scripted dev loop (FAIL→fix→ALL TESTS PASSED, file- and harness-verified) pass historically; the newest native model run issued 25 valid calls, recovered from a stale edit, saved the 88-char fix, and respected a correct POLICY_DENIED with zero bypasses.

**WHAT DOES NOT WORK:** The Gate F terminal half: a per-run `cmd /c start` terminal never appears as an ownable window (allowed PID 16576 absent from every window_list), so `window_focus` on the visible shared terminal is correctly denied and `node run.js` can never be typed through the MCP. NIM vision control does not work (tools+image HTTP 400; region misattribution; ReAct protocol never yields executable JSON). Terminal console text and Notepad doc bodies are not reliably readable via find_text/wait_for_text (E2b/E4b false-negatives; Document-control-only matches).

**WHAT REMAINS UNPROVEN:** Everything that would promote this to model-driven verified development: a model running tests through the MCP and observing the result; independent verification of a model run; repeatability of the native edit success (n=1); session-scoped authorization; retry/recovery framework; OMP orchestration; any video/audio or GLM step. Gate A has no PASS artifact today (deliberately not re-run under read-only).

**CURRENT BLOCKER:** The owned Gate F terminal PID has no window — disposable `cmd /c start` titles do not materialize as allowlisted windows under Windows Terminal's single-process tab model, so the test-run stage is structurally unreachable.

**SINGLE HIGHEST-VALUE NEXT STEP:** Switch the next Gate F attempt to the persistent-terminal pattern already encoded in `setup-editor-only.mjs` (discover the one live WindowsTerminal window read-only, allowlist its real PID plus the Notepad PID, guard every injection with the Gate E `requireOwnTab` title check) and run the full model-driven loop once without changing any MCP safety semantics.

---

## 20. Machine-readable result

```json
{
  "blueprint_version": "missing-no-file-2026-09-13",
  "mcp_core": "[VERIFIED LIVE]",
  "windows_runtime": "[VERIFIED LIVE]",
  "native_opencode_mcp": "[VERIFIED LIVE]",
  "muse_spark_control": "[IMPLEMENTED / UNVERIFIED]",
  "vision": "[VERIFIED HISTORICALLY]",
  "gate_a": "[IMPLEMENTED / UNVERIFIED]",
  "gate_b": "[VERIFIED HISTORICALLY]",
  "gate_c": "[VERIFIED HISTORICALLY]",
  "gate_d": "[VERIFIED HISTORICALLY]",
  "gate_e": "[VERIFIED HISTORICALLY]",
  "gate_f": "[FAILED]",
  "window_scope": "[IMPLEMENTED / UNVERIFIED]",
  "wait_retry": "[IMPLEMENTED / UNVERIFIED]",
  "independent_verifier": "VERIFIER PARTIAL",
  "omp_muse_orchestration": "[ASPIRATIONAL / NOT IMPLEMENTED]",
  "glm_worker": "[ASPIRATIONAL / NOT IMPLEMENTED]",
  "video_audio_perception": "[ASPIRATIONAL / NOT IMPLEMENTED]",
  "current_maturity": "BOUNDED SCRIPTED AUTOMATION WITH ONE HONEST NATIVE MODEL EDIT",
  "current_position": "M1 Close Gate F - edit half demonstrated once, test-run half blocked by terminal window lifetime",
  "marker_status": "MARKER NEEDS UPDATE",
  "current_blocker": "Owned Gate F terminal PID has no window under disposable cmd /c start on Windows Terminal; tests unrunnable via MCP within allowlist",
  "next_step": "Run next Gate F on persistent-terminal pattern (setup-editor-only.mjs discovery + requireOwnTab guard), changing no MCP safety semantics"
}
```

---

*Audit method: read-only file/hash inspection, live read-only `window_list`/`find_text`/`observe` (scr-0/1/2-mtzj*), UTF-16-decoded trace analysis (ses_f66403272ffeiaN4UxZ89e3mS9, 84 lines, 25 tool uses), artifact review (gate-b/c/d/e .txt, checkpoints, worker/react/probe JSON), source schema verification (not README inference). No build/test run, no mutation, no process/window change, no config change. Future engineer resume point: §16 + §19 next step; strict Gate F 8-conjunct definition in §10.*
