import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { Mcp, parseToolResult } from "./mcp-client.mjs";

// Re-focus owned Notepad with VERIFICATION (poll window_list until foreground
// really is our tab), then capture. Deterministic; no model involved.
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const parse = (r) => parseToolResult(r);
let gated = null;
try {
  const f0 = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: "false", COMPUTER_CONTROL_LOG: "error" });
  await f0.start();
  const wl0 = parse(await f0.callTool("window_list", {}));
  f0.stop();
  const termWin0 = wl0.json.windows.find(w => String(w.title).includes("cc-vision-term-"));
  const noteWin0 = wl0.json.windows.find(w => String(w.title).includes("note.txt"));
  if (!termWin0 || !noteWin0) throw new Error(`probe windows gone term=${!!termWin0} note=${!!noteWin0}`);
  console.log(`FOUND term=${termWin0.hwnd} note=${noteWin0.hwnd}`);
  gated = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: "true", COMPUTER_CONTROL_ALLOWED_PIDS: `${termWin0.pid},${noteWin0.pid}`, COMPUTER_CONTROL_LOG: "error" });
  await gated.start();
  const call = (n, a, t) => gated.callTool(n, a, t);
  let focused = false;
  for (let i = 0; i < 12 && !focused; i++) {
    await call("window_focus", { hwnd: noteWin0.hwnd });
    await sleep(700);
    const wl = parse(await call("window_list", {}));
    const fg = (wl.json.windows ?? []).find(w => w.is_foreground);
    focused = fg && fg.hwnd === noteWin0.hwnd;
    console.log(`try${i}: fg=${fg ? fg.title + '/' + fg.hwnd : '<none>'}`);
  }
  if (!focused) throw new Error("notepad focus would not stick; refusing to capture a lie");
  const cap = parse(await call("observe", { target: { window: noteWin0.hwnd }, max_dimension: 1024 }));
  const cs = cap.raw?.content ?? [];
  const img = cs.find(c => c.type === "image");
  const meta = JSON.parse((cs.find(c => c.type === "text")?.text ?? "{}"));
  writeFileSync("C:/gates/probe-vision3.json", JSON.stringify({
    t: new Date().toISOString(), screen_id: meta.screen_id, image_meta: meta.image,
    foreground: meta.foreground, b64: img?.data ?? null,
  }));
  console.log(`RECAPTURE_OK sid=${meta.screen_id} fg=${meta.foreground?.title} bytes=${img?.data?.length ?? 0}`);
} catch (e) { console.error(`RECAPTURE_FAIL ${e && e.message ? e.message : e}`); process.exitCode = 1; }
finally { try { if (gated) gated.stop(); } catch {} setTimeout(() => process.exit(0), 500).unref(); }
