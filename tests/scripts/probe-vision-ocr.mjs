import { Mcp, parseToolResult } from "./mcp-client.mjs";
const parse = (r) => parseToolResult(r);
const mcp = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: "false", COMPUTER_CONTROL_LOG: "error" });
try {
  await mcp.start();
  for (const [q, eng] of [["PROBE-DOC-5731", "ocr"], ["beige", "ocr"], ["PROBE-DOC-5731", "uia"], ["8842", "ocr"]]) {
    const r = parse(await mcp.callTool("find_text", { text: q, scope: "foreground", engine: eng, limit: 5 }));
    console.log(JSON.stringify(q), eng, "->", JSON.stringify({ ocr: r.json.ocr_available, engines: r.json.engines_used, matches: (r.json.matches ?? []).map(m => ({ text: String(m.text).slice(0, 50), src: m.source })) }));
  }
} finally { try { mcp.stop(); } catch {} setTimeout(() => process.exit(0), 500).unref(); }
