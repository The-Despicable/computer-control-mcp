import { writeFileSync } from "node:fs";
import { Mcp, parseToolResult } from "./mcp-client.mjs";

// Fresh verified observation of one owned window: focus, verify foreground,
// capture. Prints JSON path. Read-only except focusing OUR OWN window.
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const parse = (r) => parseToolResult(r);
const which = process.argv[2] === "note" ? "note.txt" : "cc-vision-term-";
let gated = null;
try {
  const f0 = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: "false", COMPUTER_CONTROL_LOG: "error" });
  await f0.start();
  const wl0 = parse(await f0.callTool("window_list", {}));
  f0.stop();
  const term = wl0.json.windows.find(w => String(w.title).includes("cc-vision-term-"));
  const note = wl0.json.windows.find(w => String(w.title).includes("note.txt"));
  if (!term || !note) throw new Error("probe windows gone");
  const target = which === "note.txt" ? note : term;
  gated = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: "true", COMPUTER_CONTROL_ALLOWED_PIDS: `${term.pid},${note.pid}`, COMPUTER_CONTROL_LOG: "error" });
  await gated.start();
  const call = (n, a, t) => gated.callTool(n, a, t);
  let ok = false;
  for (let i = 0; i < 10 && !ok; i++) {
    await call("window_focus", { hwnd: target.hwnd });
    await sleep(700);
    const wl = parse(await call("window_list", {}));
    const fg = (wl.json.windows ?? []).find(w => w.is_foreground);
    ok = fg && fg.hwnd === target.hwnd;
  }
  if (!ok) throw new Error(`focus would not stick on ${which}`);
  const cap = parse(await call("observe", { target: { window: target.hwnd }, max_dimension: 1024 }));
  const cs = cap.raw?.content ?? [];
  const img = cs.find(c => c.type === "image");
  const meta = JSON.parse((cs.find(c => c.type === "text")?.text ?? "{}"));
  const out = process.argv[3] || "C:/gates/probe-shot.json";
  writeFileSync(out, JSON.stringify({ t: new Date().toISOString(), which, screen_id: meta.screen_id, image_meta: meta.image, foreground: meta.foreground, b64: img?.data ?? null }));
  console.log(`SHOT_OK ${which} sid=${meta.screen_id} fg=${meta.foreground?.title}`);
} catch (e) { console.error(`SHOT_FAIL ${e && e.message ? e.message : e}`); process.exitCode = 1; }
finally { try { if (gated) gated.stop(); } catch {} setTimeout(() => process.exit(0), 500).unref(); }
