import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Mcp, parseToolResult, PASS, FAIL_ } from "./mcp-client.mjs";

// Gate E: bounded dev loop. The harness plays Muse: it owns the disposable project,
// drives terminal + Notepad THROUGH THE MCP ONLY, and independently verifies from the filesystem.
let failures = 0;
const check = (n, c, w) => { c ? PASS(n) : (failures++, FAIL_(n, w)); };
const parse = (r) => parseToolResult(r);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// Iteration-2 resilience: every checkpoint is appended to disk immediately so an
// OMP/Muse UI interruption can never take the result with it. Evidence lives in
// C:/gates (outside the disposable dir, which finally{} deletes).
const EVIDENCE = "C:/gates/gate-e-checkpoints.jsonl";
const RESULT_FILE = "C:/gates/gate-e-result.json";
const ckpt = (n, name, extra = {}) => {
  const rec = { t: new Date().toISOString(), runTag, checkpoint: n, name, failures, ...extra };
  try { appendFileSync(EVIDENCE, JSON.stringify(rec) + "\n"); } catch {}
  console.log(`CHECKPOINT ${n} — ${name}`);
};

const dir = mkdtempSync(join(tmpdir(), "cc-gate-e-"));
const runTag = `gate-e-${Date.now()}`;
const wdir = dir.replace(/\\/g, "/"); // forward-slash form for typed cmd lines
writeFileSync(join(dir, "math.js"), `// ${runTag}\nfunction add(a, b) {\n  return a - b; // BUG: should be a + b\n}\nmodule.exports = { add };\n`);
writeFileSync(join(dir, "run.js"),
  "const { add } = require('./math.js');\n" +
  "if (add(2, 3) === 5) { console.log('ALL TESTS PASSED'); process.exit(0); }\n" +
  "console.log('FAIL: add(2,3) returned ' + add(2, 3) + ', expected 5'); process.exit(1);\n");
ckpt(1, "project created (math.js with intentional bug + run.js)");

let termPid = null, notePid = null;
let finder = null, gated = null;
let preExistingNote = new Set();
let gatedRef = () => { throw new Error("gated server not started"); };
const lastSid = async () => parse(await gatedRef());

try {
  // Harness launches its OWN terminal + notepad. Spawned PIDs are stubs
  // (Win11 aliases / `start`), so discover the real owner PIDs read-only first.
  // NOTE: Win11 Notepad is single-instance — math.js opens as a tab in any
  // existing process. Snapshot first; cleanup must never kill foreign tabs.
  const preNote = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: "false", COMPUTER_CONTROL_LOG: "error" });
  await preNote.start();
  try {
    preExistingNote = new Set((parse(await preNote.callTool("window_list", {}))).json?.windows
      ?.filter(w => String(w.process).toLowerCase().includes("notepad")).map(w => w.pid) ?? []);
  } finally { try { preNote.stop(); } catch {} } // never leak: orphan server held the last run hostage (zombie)
  const termTitle = `cc-devloop-term-${Date.now()}`;
  const termStub = spawn("cmd.exe", ["/c", "start", `"${termTitle}"`, "cmd", "/K", `title ${termTitle}`], { shell: false, stdio: "ignore" });
  if (typeof termStub.unref === "function") termStub.unref();
  // Win11 Notepad is single-instance and the E0 loop below matches title "math":
  // OUR doc must be open BEFORE discovery, or notePid can never resolve (last run: FAIL E0 note=null).
  const earlyNote = spawn("notepad.exe", [join(dir, "math.js")], { stdio: "ignore" });
  if (typeof earlyNote.unref === "function") earlyNote.unref();
  await sleep(3000);
  finder = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: "false", COMPUTER_CONTROL_LOG: "error" });
  await finder.start();
  for (let i = 0; i < 20 && (!termPid || !notePid); i++) {
    await sleep(750);
    const wl = parse(await finder.callTool("window_list", {}));
    if (!termPid) {
      const t = wl.json.windows.find(w => String(w.title).includes(termTitle));
      if (t) termPid = t.pid;
    }
    if (!notePid) {
      const n = wl.json.windows.find(w => !w.is_minimized &&
        String(w.process).toLowerCase().includes("notepad") && String(w.title).includes("math"));
      if (n) notePid = n.pid;
    }
  }
  finder.stop(); finder = null;
  check("E0 harness windows appeared", !!termPid && !!notePid, `term=${termPid} note=${notePid}`);
  if (!termPid || !notePid) throw new Error("harness windows missing; aborting");

  // Gated server: input can only reach the two harness-owned windows.
  gated = new Mcp({
    COMPUTER_CONTROL_INPUT_ENABLED: "true",
    COMPUTER_CONTROL_ALLOWED_PIDS: `${termPid},${notePid}`,
    COMPUTER_CONTROL_LOG: "error",
  });
  await gated.start();
  const call = (name, args, t) => gated.callTool(name, args, t);
  gatedRef = () => gated.callTool("observe", { target: "screen" });
  const wl = parse(await call("window_list", {}));
  const termWin = wl.json.windows.find(w => w.pid === termPid && String(w.title).includes(termTitle));
  const noteWin = wl.json.windows.find(w => w.pid === notePid);
  check("E1 harness windows found", !!termWin && !!noteWin, "terminal/notepad window missing");
  if (!termWin || !noteWin) throw new Error("harness windows missing after gating; aborting");
  // The WT window is SHARED with the user's tabs: our tab is identified by its
  // unique title. Refuse injections the moment another tab is active — typing
  // into a foreign tab is worse than failing loudly.
  const requireOwnTab = async (step) => {
    const cur = parse(await call("window_list", {}));
    const entry = (cur.json.windows ?? []).find(w => w.hwnd === termWin.hwnd);
    const title = entry ? String(entry.title) : "<window gone>";
    if (!title.includes(termTitle))
      throw new Error(`${step}: terminal tab switched externally (active=${JSON.stringify(title)}); refusing to inject`);
  };
  // 1) run tests in the terminal via MCP: focus -> click shell pane -> type -> Enter key -> wait for FAIL text.
  // (Click puts the caret in the shell; Enter travels as a key, never as pasted text,
  // so no multiline-paste confirmation can intercept it.)
  await call("window_focus", { hwnd: termWin.hwnd });
  await call("wait", { duration_ms: 500 });
  const tob = parse(await call("observe", { target: { window: termWin.hwnd } }));
  if (!tob.json?.image) throw new Error("terminal observe returned no image");
  const tcl = parse(await call("click", { screen_id: tob.json.screen_id, x: Math.floor(tob.json.image.width / 2), y: Math.floor(tob.json.image.height * 0.6) }));
  if (tcl.json?.ok !== true) throw new Error(`terminal click failed: ${JSON.stringify(tcl.json)}`);
  await call("wait", { duration_ms: 500 });
  await requireOwnTab("E2-type");
  const ttype = parse(await call("type", { screen_id: tcl.json.screen_id, text: `node "${wdir}/run.js" > "${wdir}/out1.txt" 2>&1` }));
  await requireOwnTab("E2-enter");
  await call("key_press", { screen_id: ttype.json.screen_id, keys: "enter" });
  await sleep(4000); // node startup + run
  let failText = "";
  try { failText = readFileSync(join(dir, "out1.txt"), "utf8"); } catch { failText = ""; }
  check("E2 failing test produced via MCP-typed command (file-verified)", failText.includes("FAIL: add(2,3)"), JSON.stringify(failText.slice(0, 200)));
  ckpt(2, "bug identified (MCP-typed run produced FAIL, file-verified)", { failText: failText.slice(0, 120) });
  try {
    const failObs = parse(await call("wait_for_text", { text: "FAIL: add(2,3)", timeout_ms: 8000, poll_ms: 500 }));
    console.log(`E2b console-visibility probe: found=${failObs.json?.found === true}`);
  } catch (e) { console.log(`E2b console-visibility probe: ${e && e.message ? String(e.message).slice(0, 120) : e}`); }

  // 2) fix the code in Notepad via MCP: activate OUR tab by path (single-instance
  // Notepad shares tabs across runs), verify the run marker, then select-all/replace/save.
  const reactStub = spawn("notepad.exe", [join(dir, "math.js")], { stdio: "ignore" });
  if (typeof reactStub.unref === "function") reactStub.unref();
  await sleep(1200);
  await call("window_focus", { hwnd: noteWin.hwnd });
  const ob = parse(await call("observe", { target: { window: noteWin.hwnd } }));
  const cl = parse(await call("click", { screen_id: ob.json.screen_id, x: Math.floor(ob.json.image.width / 2), y: Math.floor(ob.json.image.height * 0.6) }));
  await call("wait", { duration_ms: 500 }); // focus-settle before select-all + typing
  const pre = parse(await call("find_text", { text: runTag, scope: "foreground", limit: 3 }));
  if ((pre.json.matches ?? []).length === 0) throw new Error("owned math.js tab not active; refusing to edit a foreign tab");
  const sel = parse(await call("key_press", { screen_id: cl.json.screen_id, keys: "ctrl+a" }));
  const fixed = `// ${runTag}\nfunction add(a, b) {\n  return a + b;\n}\nmodule.exports = { add };\n`;
  const ty = parse(await call("type", { screen_id: sel.json.screen_id, text: fixed }));
  // Muse-loop discipline: verify the replacement is visible BEFORE saving;
  // on a live desktop a transient focus theft can silently eat a keystroke
  // burst. One bounded retry, then the disk check judges.
  const vis = parse(await call("find_text", { text: "return a + b", scope: "foreground", limit: 3 }));
  let saveSid = ty.json.screen_id;
  if ((vis.json.matches ?? []).length === 0) {
    console.log("E3 retry: replacement not visible, re-clicking and retyping once");
    const ob2 = parse(await call("observe", { target: { window: noteWin.hwnd } }));
    const cl2 = parse(await call("click", { screen_id: ob2.json.screen_id, x: Math.floor(ob2.json.image.width / 2), y: Math.floor(ob2.json.image.height * 0.6) }));
    await call("wait", { duration_ms: 500 });
    await call("key_press", { screen_id: cl2.json.screen_id, keys: "ctrl+a" });
    const ty2 = parse(await call("type", { screen_id: cl2.json.screen_id, text: fixed }));
    saveSid = ty2.json.screen_id;
  }
  ckpt(3, "source changed in editor (replacement typed, visibility checked)");
  await call("key_press", { screen_id: saveSid, keys: "ctrl+s" });
  await sleep(800);
  const disk = readFileSync(join(dir, "math.js"), "utf8");
  check("E3 fix actually landed in the file (independent fs verification)", disk === fixed, JSON.stringify(disk));
  ckpt(4, "source saved (disk content matches fix)");
  ckpt(7, "correction applied (single fix cycle: a - b -> a + b)");

  // 3) rerun tests via terminal (same click/type/Enter discipline); wait for success text
  await call("window_focus", { hwnd: termWin.hwnd });
  await call("wait", { duration_ms: 500 });
  const tob2 = parse(await call("observe", { target: { window: termWin.hwnd } }));
  if (!tob2.json?.image) throw new Error(`terminal re-observe failed: ${JSON.stringify(tob2.json).slice(0, 300)}`);
  const tcl2 = parse(await call("click", { screen_id: tob2.json.screen_id, x: Math.floor(tob2.json.image.width / 2), y: Math.floor(tob2.json.image.height * 0.6) }));
  if (tcl2.json?.ok !== true) throw new Error(`terminal re-click failed: ${JSON.stringify(tcl2.json)}`);
  await call("wait", { duration_ms: 500 });
  await requireOwnTab("E4-type");
  const ttype2 = parse(await call("type", { screen_id: tcl2.json.screen_id, text: `node "${wdir}/run.js" > "${wdir}/out2.txt" 2>&1` }));
  await requireOwnTab("E4-enter");
  await call("key_press", { screen_id: ttype2.json.screen_id, keys: "enter" });
  await sleep(4000);
  let passText = "";
  try { passText = readFileSync(join(dir, "out2.txt"), "utf8"); } catch { passText = ""; }
  check("E4 passing test produced via MCP-typed command (file-verified)", passText.includes("ALL TESTS PASSED"), JSON.stringify(passText.slice(0, 200)));
  ckpt(5, "tests executed after fix (MCP-typed rerun)");
  ckpt(6, "passing state observed (file-verified)", { passText: passText.slice(0, 120) });
  try {
    const passObs = parse(await call("wait_for_text", { text: "ALL TESTS PASSED", timeout_ms: 8000, poll_ms: 500 }));
    console.log(`E4b console-visibility probe: found=${passObs.json?.found === true}`);
  } catch (e) { console.log(`E4b console-visibility probe: ${e && e.message ? String(e.message).slice(0, 120) : e}`); }

  // Close OUR WT tab gracefully so no dead panes litter the shared terminal.
  // Best-effort: the finally taskkill remains as fallback.
  try {
    await call("window_focus", { hwnd: termWin.hwnd });
    await requireOwnTab("cleanup-exit");
    const eob = parse(await call("observe", { target: "screen", max_dimension: 640 }));
    const ext = parse(await call("type", { screen_id: eob.json.screen_id, text: "exit" }));
    await call("key_press", { screen_id: ext.json.screen_id, keys: "enter" });
    await sleep(1500);
    console.log("cleanup: exit sent to owned terminal tab");
  } catch (e) { console.log(`cleanup exit skipped: ${e && e.message ? String(e.message).slice(0, 120) : e}`); }

  // 4) Muse-side independent verification: run the tests itself, outside the GUI
  const out = await new Promise((res) => {
    const p = spawn("node", ["run.js"], { cwd: dir, shell: false });
    let o = "";
    if (p.stdout) p.stdout.on("data", d => { o += d; });
    p.on("close", () => res(o));
  });
  check("E5 independent rerun of tests passes", out.includes("ALL TESTS PASSED"), out);
  ckpt(8, "tests pass (MCP-driven rerun green)");
  ckpt(9, "independent filesystem verification (harness-side node run.js green)");

  ckpt(10, failures === 0 ? "verdict PASS" : "verdict FAIL");
  try { writeFileSync(RESULT_FILE, JSON.stringify({ t: new Date().toISOString(), runTag, verdict: failures === 0 ? "PASS" : "FAIL", failures }) + "\n"); } catch {}
  console.log(`GATE_E_RESULT ${JSON.stringify({ verdict: failures === 0 ? "PASS" : "FAIL", failures, runTag })}`);
  console.log(failures === 0 ? "\nGATE E: PASS — bounded dev loop completed via MCP" : `\nGATE E: ${failures} FAILURES`);
  if (failures > 0) process.exitCode = 1;
} catch (e) { failures++; FAIL_("E0", e.message); try { writeFileSync(RESULT_FILE, JSON.stringify({ t: new Date().toISOString(), runTag, verdict: "FAIL", failures, error: String(e && e.message ? e.message : e).slice(0, 300) }) + "\n"); } catch {} console.log(`GATE_E_RESULT ${JSON.stringify({ verdict: "FAIL", failures, runTag })}`); }
finally {
  try { if (finder) finder.stop(); } catch {}
  try { if (gated) gated.stop(); } catch {}
  // Terminal window is uniquely titled per run (safe). Notepad is single-instance:
  // kill only a process this run created, never a pre-existing shared one.
  if (termPid) { try { const k = spawn("taskkill", ["/PID", String(termPid), "/T", "/F"], { stdio: "ignore" }); if (typeof k.unref === "function") k.unref(); } catch {} }
  if (notePid && !preExistingNote.has(notePid)) { try { const k = spawn("taskkill", ["/PID", String(notePid), "/T", "/F"], { stdio: "ignore" }); if (typeof k.unref === "function") k.unref(); } catch {} }
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}
