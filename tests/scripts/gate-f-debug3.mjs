import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

import { dirname, join } from "node:path";

const ENTRY = join("/home/yaser/keyboard", "dist", "src", "index.js");
const PS = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";
console.log("PS exists:", existsSync(PS));

// Test 1: direct spawn from Node
const t1 = spawn(PS, ["-NoProfile", "-Command", "Write-Output 'test1'"], { stdio: "pipe" });
let t1out = "";
t1.stdout.on("data", d => t1out += d);
t1.on("close", c => console.log("Test1 direct spawn:", c, t1out.trim()));

// Test 2: spawn with env that MCP would have
const env = {
  ...process.env,
  COMPUTER_CONTROL_INPUT_ENABLED: "true",
  COMPUTER_CONTROL_LOG: "error",
  COMPUTER_CONTROL_POWERSHELL: PS,
};
await new Promise(r => setTimeout(r, 500));

// Test 3: what the MCP server actually does
const t3 = spawn(PS, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "/home/yaser/keyboard/dist/src/windows-backend/scripts/state.ps1"], { cwd: "C:\\", env, stdio: "pipe" });
let t3out = "";
t3.stdout.on("data", d => t3out += d);
t3.stderr.on("data", d => console.error("PS3 ERR:", d.trim().substring(0, 200)));
t3.on("close", c => console.log("Test3 backend script:", c, t3out.substring(0, 200)));

await new Promise(r => setTimeout(r, 10000));
