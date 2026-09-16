import { readFileSync } from "node:fs";
import { Mcp, parseToolResult } from "./mcp-client.mjs";

// Blind single-action runner: executes EXACTLY ONE model-chosen MCP call on
// allowlisted self-owned windows, prints the result, exits. No reasoning here:
// the tool name + arguments come from argv (the model's verbatim decision).
// All MCP-side validation (screen_id, freshness, foreground, allowlist) applies.
const parse = (r) => parseToolResult(r);
const tool = process.argv[2];
const args = JSON.parse(readFileSync(process.argv[3], "utf8"));
let gated = null;
try {
  const f0 = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: "false", COMPUTER_CONTROL_LOG: "error" });
  await f0.start();
  const wl0 = parse(await f0.callTool("window_list", {}));
  f0.stop();
  const term = wl0.json.windows.find(w => String(w.title).includes("cc-vision-term-"));
  const note = wl0.json.windows.find(w => String(w.title).includes("note.txt"));
  if (!term || !note) throw new Error("probe windows gone");
  gated = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: "true", COMPUTER_CONTROL_ALLOWED_PIDS: `${term.pid},${note.pid}`, COMPUTER_CONTROL_LOG: "error" });
  await gated.start();
  const res = await gated.callTool(tool, args, 90000);
  const cs = res?.content ?? [];
  const out = { text: cs.filter(c => c.type === "text").map(c => c.text).join("\n").slice(0, 4000), has_image: cs.some(c => c.type === "image") };
  console.log(`ACTION_RESULT ${JSON.stringify(out)}`);
} catch (e) { console.log(`ACTION_RESULT ${JSON.stringify({ error: String(e && e.message ? e.message : e).slice(0, 500) })}`); process.exitCode = 1; }
finally { try { if (gated) gated.stop(); } catch {} setTimeout(() => process.exit(0), 500).unref(); }
