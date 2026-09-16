import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = "/home/yaser/keyboard";
const ENTRY = join(ROOT, "dist", "src", "index.js");

// Start MCP server with full env including PATH
const env = {
  ...process.env,
  COMPUTER_CONTROL_INPUT_ENABLED: "true",
  COMPUTER_CONTROL_LOG: "error",
  COMPUTER_CONTROL_POWERSHELL: "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
};

const proc = spawn(process.execPath, [ENTRY], { env, stdio: ["pipe", "pipe", "pipe"] });
let seq = 0;
const pending = new Map();
const buf = "";
let stderr = "";

proc.stdout.setEncoding("utf8").on("data", (chunk) => {
  // console.error("STDOUT:", chunk);
});
proc.stderr.setEncoding("utf8").on("data", (d) => {
  stderr += d;
  console.error("MCP stderr:", d.trim());
});
proc.on("error", (e) => console.error("PROC ERROR:", e.message));
proc.on("close", (c) => console.error("PROC EXIT:", c));

// Wait for ready
await new Promise(r => setTimeout(r, 2000));

// Try spawning PowerShell directly from within Node to test
console.log("PATH:", process.env.PATH?.substring(0, 200));

const psTest = spawn("/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
  ["-NoProfile", "-NonInteractive", "-Command", "Write-Output 'hello'"],
  { env, stdio: ["pipe", "pipe", "pipe"] });
let psOut = "";
psTest.stdout.setEncoding("utf8").on("data", d => { psOut += d; });
psTest.stderr.setEncoding("utf8").on("data", d => { console.error("PS ERR:", d.trim()); });
psTest.on("error", e => console.error("PS SPAWN ERROR:", e.message));
psTest.on("close", (c) => {
  console.error("PS EXIT:", c, "OUT:", psOut.trim());
});

// Now try the MCP window_list
await new Promise(r => setTimeout(r, 3000));

const id = ++seq;
pending.set(id, (m) => {
  console.log("RESULT:", JSON.stringify(m, null, 2).substring(0, 2000));
});
proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "window_list", arguments: {} } }) + "\n");

await new Promise(r => setTimeout(r, 15000));
proc.kill();
