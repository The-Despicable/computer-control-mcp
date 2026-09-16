import { spawn } from "node:child_process";
import { dirname, join } from "node:path";

const ENTRY = join("/home/yaser/keyboard", "dist", "src", "index.js");

const env = {
  ...process.env,
  COMPUTER_CONTROL_INPUT_ENABLED: "true",
  COMPUTER_CONTROL_LOG: "error",
  COMPUTER_CONTROL_POWERSHELL: "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
};

const proc = spawn(process.execPath, [ENTRY], { env, stdio: ["pipe", "pipe", "pipe"] });
let seq = 0;
const pending = new Map();

proc.stdout.setEncoding("utf8").on("data", (chunk) => {
  console.error("RAW STDOUT:", chunk.substring(0, 300));
  let nl;
  const buf = proc._buf || (proc._buf = "");
  proc._buf = buf + chunk;
  while ((nl = proc._buf.indexOf("\n")) >= 0) {
    const line = proc._buf.slice(0, nl).trim();
    proc._buf = proc._buf.slice(nl + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      console.error("PARSED:", JSON.stringify(msg).substring(0, 300));
      if (typeof msg.id === "number" && pending.has(msg.id)) {
        const cb = pending.get(msg.id);
        pending.delete(msg.id);
        cb(msg);
      }
      if (msg.method === "notifications/initialized") {
        console.error("Got initialized notification");
      }
    } catch (e) {
      console.error("PARSE ERROR:", e.message, "line:", line.substring(0, 100));
    }
  }
});
proc.stderr.setEncoding("utf8").on("data", (d) => {
  console.error("MCP stderr:", d.trim());
});
proc.on("error", (e) => console.error("PROC ERROR:", e.message));

await new Promise(r => setTimeout(r, 3000));

// Initialize
const initId = ++seq;
pending.set(initId, (m) => {
  console.error("INIT RESPONSE:", JSON.stringify(m).substring(0, 500));
  // Send initialized notification
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  // Now call window_list after a brief delay
  setTimeout(async () => {
    const callId = ++seq;
    pending.set(callId, (m) => {
      console.error("TOOL RESPONSE:", JSON.stringify(m).substring(0, 2000));
      proc.kill();
    });
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: callId, method: "tools/call", params: { name: "window_list", arguments: {} } }) + "\n");
  }, 1000);
});
proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: initId, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } } }) + "\n");

await new Promise(r => setTimeout(r, 30000));
if (proc.exitCode === null) proc.kill();
