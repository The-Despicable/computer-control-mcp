import { Mcp, parseToolResult } from "./gate-f-client.mjs";

const mcp = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: "true", COMPUTER_CONTROL_LOG: "error", COMPUTER_CONTROL_POWERSHELL: "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe" });

try {
  await mcp.start();
  console.log("MCP server started");

  // List tools
  const tools = await mcp.listTools();
  const toolNames = parseToolResult(tools).json?.tools?.map(t => t.name) ?? [];
  console.log("Tools:", toolNames.join(", "));

  // List windows
  console.log("\n--- window_list ---");
  const windows = await mcp.callTool("window_list", {});
  const winResult = parseToolResult(windows);
  console.log("Error:", winResult.json?.error ? JSON.stringify(winResult.json.error) : "none");
  const wins = winResult.json?.windows ?? [];
  console.log("Windows found:", wins.length);
  for (const w of wins) {
    console.log(`  hwnd=${w.hwnd} pid=${w.pid} proc=${w.process} title="${w.title}" bounds=${JSON.stringify(w.bounds)}`);
  }

  // Try observe screen
  console.log("\n--- observe screen ---");
  const obs = await mcp.callTool("observe", { target: "screen", format: "png", max_dimension: 1280 });
  const obsResult = parseToolResult(obs);
  console.log("Error:", obsResult.json?.error ? JSON.stringify(obsResult.json.error) : "none");
  console.log("Has image:", !!obsResult.image);
  console.log("Text:", obsResult.text?.substring(0, 500) ?? "none");
  if (obsResult.image) {
    console.log("Image size:", obsResult.image.data.length, "bytes");
  }

  // Try perceive summary
  console.log("\n--- perceive summary ---");
  const perc = await mcp.callTool("find_text", { text: "add", scope: "desktop", limit: 10 });
  const percResult = parseToolResult(perc);
  console.log("Error:", percResult.json?.error ? JSON.stringify(percResult.json.error) : "none");
  console.log("Matches:", JSON.stringify(percResult.json?.matches ?? [], null, 1)?.substring(0, 1000));

} catch (e) {
  console.error("ERROR:", e.message);
} finally {
  mcp.stop();
}
