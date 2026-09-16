import { spawn } from "node:child_process";
import { Mcp, parseToolResult } from "./mcp-client.mjs";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
spawn("notepad.exe", ["C:\\gates\\probe-doc.txt"], { stdio: "ignore" });
await sleep(2000);
const mcp = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: "true", COMPUTER_CONTROL_LOG: "error" });
await mcp.start();
try {
  const wl = parseToolResult(await mcp.callTool("window_list", {}));
  const np = wl.json.windows.find(w => !w.is_minimized && String(w.process).toLowerCase().includes("notepad") && String(w.title).includes("probe-doc"));
  if (!np) throw new Error("probe-doc not active");
  await mcp.callTool("window_focus", { hwnd: np.hwnd });
  const ob = parseToolResult(await mcp.callTool("observe", { target: { window: np.hwnd } }));
  const cl = parseToolResult(await mcp.callTool("click", { screen_id: ob.json.screen_id, x: Math.floor(ob.json.image.width / 2), y: Math.floor(ob.json.image.height * 0.85) }));
  await mcp.callTool("wait", { duration_ms: 500 });
  await mcp.callTool("key_press", { screen_id: cl.json.screen_id, keys: "ctrl+end" });
  const payload = "ZZZ111222333444555666777888999000AAABBBCCC";
  const ty = parseToolResult(await mcp.callTool("type", { screen_id: cl.json.screen_id, text: "\n" + payload + "\n" }));
  console.log("TYPE:", JSON.stringify(ty.json));
  console.log("SENT:", JSON.stringify(payload));
} finally { mcp.stop(); }
