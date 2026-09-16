import { spawn } from "node:child_process";

const ENTRY = "/home/yaser/keyboard/dist/src/index.js";
const PS = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";

const env = {
  ...process.env,
  COMPUTER_CONTROL_INPUT_ENABLED: "true",
  COMPUTER_CONTROL_LOG: "error",
  COMPUTER_CONTROL_POWERSHELL: PS,
};

const proc = spawn(process.execPath, [ENTRY], { env, stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
const pending = new Map();

proc.stdout.setEncoding("utf8").on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (typeof msg.id === "number" && pending.has(msg.id)) {
        const cb = pending.get(msg.id);
        pending.delete(msg.id);
        cb(msg);
      }
    } catch {}
  }
});
proc.stderr.setEncoding("utf8").on("data", (d) => {
  // Silent
});
proc.on("error", (e) => console.error("PROC ERR:", e.message));
proc.on("close", (c) => console.error("PROC EXIT:", c));

await new Promise(r => setTimeout(r, 2000));

// Initialize
const initId = 1;
pending.set(initId, (m) => {
  console.log("INIT:", JSON.stringify(m).substring(0, 200));
  // Send initialized
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  // Call listTools after delay
  setTimeout(() => {
    const listId = 2;
    pending.set(listId, (m) => {
      console.log("LIST TOOLS:", JSON.stringify(m).substring(0, 500));

      // Call window_list
      const winId = 3;
      pending.set(winId, (m) => {
        console.log("WINDOW LIST:", JSON.stringify(m).substring(0, 1000));
        proc.kill();
      });
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: winId, method: "tools/call", params: { name: "window_list", arguments: {} } }) + "\n");
    });
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: listId, method: "tools/call", params: { name: "tools/list", arguments: {} } }) + "\n");
  }, 500);
});
proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: initId, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } } }) + "\n");

await new Promise(r => setTimeout(r, 30000));
if (proc.exitCode === null) proc.kill();
