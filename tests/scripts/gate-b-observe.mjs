import { Mcp, parseToolResult, PASS, FAIL_ } from "./mcp-client.mjs";

const mcp = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: "false", COMPUTER_CONTROL_LOG: "error" });
let failures = 0;
const check = (name, cond, why) => { cond ? PASS(name) : (failures++, FAIL_(name, why)); };

try {
  await mcp.start();
  check("B1 handshake (initialize answered)", true);
  const tools = (await mcp.listTools()).tools.map(t => t.name);
  const expected = ["observe", "window_list", "window_focus", "find_text", "find_element",
    "click", "type", "key_press", "scroll", "wait", "wait_for_text", "wait_for_change"];
  check("B2 tools/list has the 12 expected tools", expected.every(t => tools.includes(t)), `got: ${tools.join(",")}`);
  const r1 = await mcp.callTool("observe", {});
  const p1 = parseToolResult(r1);
  check("B3 observe returns MCP image content block", p1.image?.type === "image" && !!p1.image.data, JSON.stringify(r1).slice(0, 200));
  const bytes = Buffer.from(p1.image?.data ?? "", "base64");
  check("B4 image bytes non-empty and PNG magic", bytes.length > 100 && bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])), `len=${bytes.length}`);
  const meta = p1.json ?? {};
  check("B5 metadata includes screen_id", /^scr-\d+-/.test(meta.screen_id ?? ""), JSON.stringify(meta).slice(0, 200));
  check("B6 metadata includes real timestamp", typeof meta.timestamp === "number" && Math.abs(Date.now() - meta.timestamp) < 120000, String(meta.timestamp));
  check("B7 metadata includes monitor geometry + virtual_screen", Array.isArray(meta.monitors) && meta.monitors.length >= 1 && meta.virtual_screen?.w > 0);
  const r2 = await mcp.callTool("observe", {});
  const p2 = parseToolResult(r2);
  const fg1 = meta.foreground, fg2 = p2.json?.foreground;
  const stable = fg1?.pid && fg2?.pid && fg1.pid === fg2.pid && fg1.pid > 4;
  check("B8 same foreground window => same owning PID (no $PID bug)", !!stable, JSON.stringify({ fg1, fg2 }));
  const raw = JSON.stringify(r1);
  check("B9 no screenshot_path / file path exposed as the image", !/"[^"]*(screenshot_?path|\.png"|\.jpg")[^"]*"/i.test(raw));
  const wl = parseToolResult(await mcp.callTool("window_list", {}));
  check("B10 window_list returns windows with real pid/hwnd", (wl.json?.windows ?? []).length > 0 && wl.json.windows[0].pid > 4);
  console.log(failures === 0 ? "\nGATE B: ALL PASS" : `\nGATE B: ${failures} FAILURES`);
  if (failures > 0) process.exitCode = 1;
} finally { mcp.stop(); }
