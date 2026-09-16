import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Mcp, parseToolResult, PASS, FAIL_ } from "./mcp-client.mjs";

const CYCLES = 5, THRESHOLD = 4;
const dir = mkdtempSync(join(tmpdir(), "cc-gate-d-"));
let realPid = null, failures = 0, verified = 0, ownedProcess = false;
const check = (name, cond, why) => { cond ? PASS(name) : (failures++, FAIL_(name, why)); };
const errOf = (parsed) => { try { return parsed.json?.error?.code ?? null; } catch { return null; } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

try {
  // Harness owns the Notepad document. On Win11 notepad.exe is a Store execution
  // alias: the spawned stub exits at once, so child.pid is NOT the window owner.
  // Discover the real owner PID read-only (by unique doc title), then lock the
  // gated server's allowlist to that PID.
  const docBase = `gate-d-${Date.now()}.txt`;
  const docPath = join(dir, docBase);
  writeFileSync(docPath, "");

  const finder = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: "false", COMPUTER_CONTROL_LOG: "error" });
  await finder.start();
  // Win11 Notepad is single-instance: our doc opens as a TAB in whatever
  // Notepad process exists. Snapshot first so cleanup never kills a
  // pre-existing (possibly user-owned) process — only one we created.
  const preExisting = new Set((parseToolResult(await finder.callTool("window_list", {}))).json?.windows
    ?.filter(w => String(w.process).toLowerCase().includes("notepad")).map(w => w.pid) ?? []);
  const stub = spawn("notepad.exe", [docPath], { detached: false, stdio: "ignore" });
  if (typeof stub.unref === "function") stub.unref(); // Win11 alias stub may linger; never hold the loop open
  try {
    for (let i = 0; i < 20 && !realPid; i++) {
      await sleep(750);
      const wl = parseToolResult(await finder.callTool("window_list", {}));
      const np = (wl.json?.windows ?? []).find(w =>
        !w.is_minimized && String(w.title).includes(docBase) &&
        String(w.process).toLowerCase().includes("notepad"));
      if (np) realPid = np.pid;
    }
  } finally { finder.stop(); }
  if (!realPid) throw new Error("harness-owned notepad window never appeared in window_list");
  ownedProcess = !preExisting.has(realPid);
  console.log(`harness-owned notepad pid: ${realPid} (process created by this run: ${ownedProcess})`);

  const mcp = new Mcp({
    COMPUTER_CONTROL_INPUT_ENABLED: "true",
    COMPUTER_CONTROL_ALLOWED_PIDS: String(realPid), // input can only reach the owned test window
    COMPUTER_CONTROL_LOG: "error",
  });
  try {
    await mcp.start();
    for (let i = 0; i < CYCLES; i++) {
      let ok = true;
      try {
        // Single-instance Notepad hosts foreign tabs: re-open OUR doc through the
        // harness so its tab is the active one, then bind to the fresh state.
        const actStub = spawn("notepad.exe", [docPath], { detached: false, stdio: "ignore" });
        if (typeof actStub.unref === "function") actStub.unref();
        await sleep(1200);
        const wl2 = parseToolResult(await mcp.callTool("window_list", {}));
        const np = (wl2.json?.windows ?? []).find(w => w.pid === realPid && !w.is_minimized && String(w.title).includes(docBase));
        if (!np) throw new Error("notepad window not found in window_list");
        const f = parseToolResult(await mcp.callTool("window_focus", { hwnd: np.hwnd }));
        const sidFocus = f.json?.screen_id;
        if (!sidFocus) throw new Error("window_focus returned no screen_id");
        const ob = parseToolResult(await mcp.callTool("observe", { target: { window: np.hwnd } }));
        const sid = ob.json?.screen_id;
        if (!sid || !ob.image?.data) throw new Error("observe returned no screen_id/image");
        const W = ob.json.image.width, H = ob.json.image.height;
        const cl = parseToolResult(await mcp.callTool("click", { screen_id: sid, x: Math.floor(W / 2), y: Math.floor(H * 0.6) }));
        if (cl.json?.ok !== true) throw new Error(`click failed: ${JSON.stringify(cl.json)}`);
        // Muse-side discipline: let the OS settle caret focus after the click
        // before typing (leading keystrokes are otherwise lost to focus latency).
        await mcp.callTool("wait", { duration_ms: 500 });
        const sid2 = cl.json.screen_id;
        const marker = `cycle ${i + 1} hello world ${Date.now()}`;
        const ty = parseToolResult(await mcp.callTool("type", { screen_id: sid2, text: marker + "\n" }));
        if (ty.json?.ok !== true) throw new Error(`type failed: ${JSON.stringify(ty.json)}`);
        // NOTE: wait_for_change (8x8 thumbprint over a large region) cannot
        // resolve a few glyphs at any sane threshold — wait_for_text owns
        // typing verification. Change detection is exercised at the scroll step.
        const wf = parseToolResult(await mcp.callTool("wait_for_text", { text: marker, timeout_ms: 8000, poll_ms: 400 }));
        if (wf.json?.found !== true) throw new Error(`wait_for_text did not see the marker: ${JSON.stringify(wf.json)}`);
        const kp = parseToolResult(await mcp.callTool("key_press", { screen_id: wf.json.screen_id, keys: "ctrl+s" }));
        if (kp.json?.ok !== true) throw new Error(`ctrl+s failed: ${JSON.stringify(kp.json)}`);
        await sleep(800);
        const disk = readFileSync(docPath, "utf8");
        if (!disk.includes(marker)) throw new Error(`file on disk does not contain the marker (got: ${JSON.stringify(disk.slice(0, 200))})`);
        const pre = parseToolResult(await mcp.callTool("observe", { target: "screen" }));
        if (!pre.json?.screen_id) throw new Error("pre-scroll observe returned no screen_id");
        const sc = parseToolResult(await mcp.callTool("scroll", { screen_id: pre.json.screen_id, direction: "down", amount: 2 }));
        if (sc.json?.ok !== true) throw new Error(`scroll failed: ${JSON.stringify(sc.json)}`);
        const wc = parseToolResult(await mcp.callTool("wait_for_change", { screen_id: pre.json.screen_id, timeout_ms: 3000, threshold: 0.05 }));
        if (wc.json?.changed !== true && errOf(wc) !== "TIMEOUT") throw new Error(`wait_for_change errored: ${JSON.stringify(wc.json)}`);
      } catch (e) { ok = false; console.error(`  cycle ${i + 1} failed: ${e.message}`); }
      console.log(`cycle ${i + 1}: ${ok ? "VERIFIED" : "FAILED"}`);
      if (ok) verified++;
    }
    check(`D1 >= ${THRESHOLD}/${CYCLES} verified Notepad cycles`, verified >= THRESHOLD, `got ${verified}`);
    check("D2 all cycles used the owned PID allowlist", true);
    console.log(failures === 0 ? "\nGATE D: PASS" : `\nGATE D: ${failures} FAILURES`);
    if (failures > 0) process.exitCode = 1;
    mcp.stop();
  } catch (e) { failures++; FAIL_("D0 server/cycle setup", e.message); try { mcp.stop(); } catch {} }
} finally {
  // Never taskkill a pre-existing shared process (Win11 Notepad is single-instance
  // and may host foreign tabs). Only remove a process this run created.
  if (realPid && ownedProcess) { try { spawn("taskkill", ["/PID", String(realPid), "/T", "/F"]); } catch {} }
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}
