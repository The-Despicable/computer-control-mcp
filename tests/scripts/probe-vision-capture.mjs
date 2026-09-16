import { writeFileSync } from "node:fs";
import { Mcp, parseToolResult } from "./mcp-client.mjs";

// Read-only perception probe: captures ground-truth window list + one screenshot.
// Observe-only server (input disabled). Never focuses, clicks, or types.
const mcp = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: "false", COMPUTER_CONTROL_LOG: "error" });
try {
  await mcp.start();
  const wl = parseToolResult(await mcp.callTool("window_list", {}));
  const ob = parseToolResult(await mcp.callTool("observe", { target: "screen", max_dimension: 1024, format: "png" }));
  const text = (ob.raw?.content ?? []).find(c => c.type === "text")?.text ?? "{}";
  const img = (ob.raw?.content ?? []).find(c => c.type === "image");
  const meta = JSON.parse(text);
  writeFileSync("C:/gates/probe-vision.json", JSON.stringify({
    t: new Date().toISOString(),
    screen_id: meta.screen_id ?? null,
    image_meta: meta.image ?? null,
    foreground: meta.foreground ?? null,
    windows: (wl.json?.windows ?? []).map(w => ({ pid: w.pid, title: w.title, process: w.process, bounds: w.bounds, is_foreground: w.is_foreground })),
    image_b64: img?.data ?? null,
    image_mime: img?.mimeType ?? null,
  }));
  console.log(`captured screen_id=${meta.screen_id} image_bytes=${img?.data?.length ?? 0} windows=${(wl.json?.windows ?? []).length}`);
} finally {
  try { mcp.stop(); } catch {}
  setTimeout(() => process.exit(0), 500).unref();
}
