import { Mcp, parseToolResult } from "./mcp-client.mjs";

// Read-only cross-check: where on screen do these strings live?
const parse = (r) => parseToolResult(r);
const mcp = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: "false", COMPUTER_CONTROL_LOG: "error" });
try {
  await mcp.start();
  const wl = parse(await mcp.callTool("window_list", {}));
  console.log("FG:", JSON.stringify((wl.json.windows ?? []).filter(w => w.is_foreground).map(w => ({ pid: w.pid, title: w.title, proc: w.process }))));
  console.log("NOTEPADS:", JSON.stringify((wl.json.windows ?? []).filter(w => String(w.process).toLowerCase().includes("notepad")).map(w => ({ hwnd: w.hwnd, title: w.title, min: w.is_minimized }))));
  for (const q of ["PROBE-DOC-5731", "beige badger", "GateF-Perce", "PROBE-TERM-4271"]) {
    const r = parse(await mcp.callTool("find_text", { text: q, scope: "desktop", limit: 5 }));
    console.log(JSON.stringify(q), "->", JSON.stringify((r.json.matches ?? []).map(m => ({ text: String(m.text).slice(0, 40), src: m.source, proc: m.process ?? null, automation_id: m.automation_id ?? null }))));
  }
} finally { try { mcp.stop(); } catch {} setTimeout(() => process.exit(0), 500).unref(); }
