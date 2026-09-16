import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Mcp, parseToolResult } from "./mcp-client.mjs";

// Deterministic vision-probe state setup (NO model): own terminal + own Notepad
// with KNOWN content, then ground-truth captures. All input via gated MCP on
// allowlisted self-owned windows only.
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const parse = (r) => parseToolResult(r);
const dir = mkdtempSync(join(tmpdir(), "cc-visionprobe-"));
const MARK = `PROBE-DOC-5731`;
writeFileSync(join(dir, "note.txt"), `${MARK}\nsecond line: beige badger 8842\n`);
let termPid = null, notePid = null, gated = null, finder = null;
let preExistingNote = new Set();
try {
  const pre = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: "false", COMPUTER_CONTROL_LOG: "error" });
  await pre.start();
  try {
    preExistingNote = new Set((parse(await pre.callTool("window_list", {}))).json?.windows
      ?.filter(w => String(w.process).toLowerCase().includes("notepad")).map(w => w.pid) ?? []);
  } finally { try { pre.stop(); } catch {} }
  const termTitle = `cc-vision-term-${Date.now()}`;
  const ts = spawn("cmd.exe", ["/c", "start", `"${termTitle}"`, "cmd", "/K", `title ${termTitle}`], { shell: false, stdio: "ignore" });
  if (typeof ts.unref === "function") ts.unref();
  const ns = spawn("notepad.exe", [join(dir, "note.txt")], { stdio: "ignore" });
  if (typeof ns.unref === "function") ns.unref();
  await sleep(3000);
  finder = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: "false", COMPUTER_CONTROL_LOG: "error" });
  await finder.start();
  for (let i = 0; i < 20 && (!termPid || !notePid); i++) {
    await sleep(750);
    const wl = parse(await finder.callTool("window_list", {}));
    if (!termPid) { const t = wl.json.windows.find(w => String(w.title).includes(termTitle)); if (t) termPid = t.pid; }
    if (!notePid) { const n = wl.json.windows.find(w => !w.is_minimized && String(w.process).toLowerCase().includes("notepad") && String(w.title).includes("note")); if (n) notePid = n.pid; }
  }
  finder.stop(); finder = null;
  if (!termPid || !notePid) throw new Error(`probe windows missing term=${termPid} note=${notePid}`);
  gated = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: "true", COMPUTER_CONTROL_ALLOWED_PIDS: `${termPid},${notePid}`, COMPUTER_CONTROL_LOG: "error" });
  await gated.start();
  const call = (n, a, t) => gated.callTool(n, a, t);
  const wl0 = parse(await call("window_list", {}));
  const termWin = wl0.json.windows.find(w => w.pid === termPid && String(w.title).includes(termTitle));
  const noteWin = wl0.json.windows.find(w => w.pid === notePid);
  if (!termWin || !noteWin) throw new Error("owned windows not resolved after gating");

  // Terminal: focus, click pane, type two known lines, Enter.
  await call("window_focus", { hwnd: termWin.hwnd });
  await call("wait", { duration_ms: 500 });
  const tob = parse(await call("observe", { target: { window: termWin.hwnd } }));
  const tcl = parse(await call("click", { screen_id: tob.json.screen_id, x: Math.floor(tob.json.image.width / 2), y: Math.floor(tob.json.image.height * 0.6) }));
  await call("wait", { duration_ms: 500 });
  const t1 = parse(await call("type", { screen_id: tcl.json.screen_id, text: "echo PROBE-TERM-4271" }));
  await call("key_press", { screen_id: t1.json.screen_id, keys: "enter" });
  await sleep(1500);

  // Notepad: focus own tab, click, verify marker via find_text (do NOT retype content).
  const rs = spawn("notepad.exe", [join(dir, "note.txt")], { stdio: "ignore" });
  if (typeof rs.unref === "function") rs.unref();
  await sleep(1200);
  await call("window_focus", { hwnd: noteWin.hwnd });
  const nob = parse(await call("observe", { target: { window: noteWin.hwnd } }));
  const ncl = parse(await call("click", { screen_id: nob.json.screen_id, x: Math.floor(nob.json.image.width / 2), y: Math.floor(nob.json.image.height * 0.6) }));
  await call("wait", { duration_ms: 500 });
  const fnd = parse(await call("find_text", { text: MARK, scope: "foreground", limit: 3 }));
  const markerVisible = (fnd.json.matches ?? []).length > 0;

  // Ground-truth captures: terminal close-up, notepad close-up, full screen.
  await call("window_focus", { hwnd: termWin.hwnd });
  await sleep(600);
  const capT = parse(await call("observe", { target: { window: termWin.hwnd }, max_dimension: 1024 }));
  // NOTE: probe dir + owned windows stay open for the vision quiz + control test; explicit cleanup later.
  await sleep(600);
  const capN = parse(await call("observe", { target: { window: noteWin.hwnd }, max_dimension: 1024 }));
  const capS = parse(await call("observe", { target: "screen", max_dimension: 1024 }));
  const wlF = parse(await call("window_list", {}));
  const imgOf = (p) => { const cs = p.raw?.content ?? []; const i = cs.find(c => c.type === "image"); const t = cs.find(c => c.type === "text"); return { meta: JSON.parse(t?.text ?? "{}"), b64: i?.data ?? null }; };
  const T = imgOf(capT), N = imgOf(capN), S = imgOf(capS);
  writeFileSync("C:/gates/probe-vision2.json", JSON.stringify({
    t: new Date().toISOString(), termTitle, marker: MARK, markerVisible,
    term: { screen_id: T.meta.screen_id, image_meta: T.meta.image, foreground: T.meta.foreground, b64: T.b64 },
    note: { screen_id: N.meta.screen_id, image_meta: N.meta.image, foreground: N.meta.foreground, b64: N.b64 },
    screen: { screen_id: S.meta.screen_id, image_meta: S.meta.image, foreground: S.meta.foreground, b64: S.b64 },
    windows: (wlF.json?.windows ?? []).map(w => ({ pid: w.pid, title: w.title, process: w.process, is_foreground: w.is_foreground })),
  }));
  console.log(`PROBE_STATE_OK markerVisible=${markerVisible} termSid=${T.meta.screen_id} noteSid=${N.meta.screen_id}`);
  console.log(`TERM_TITLE ${termTitle}`);
} catch (e) { console.error(`PROBE_STATE_FAIL ${e && e.message ? e.message : e}`); process.exitCode = 1; }
finally {
  try { if (finder) finder.stop(); } catch {}
  try { if (gated) gated.stop(); } catch {}
  // NOTE: leave owned windows OPEN for the follow-up vision quiz + control test; cleanup is explicit.
  console.log(`PROBE_DIR ${dir}`);
}
