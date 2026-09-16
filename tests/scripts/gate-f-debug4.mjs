import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const PS = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";

// Test A: no env, no cwd
const tA = spawn(PS, ["-NoProfile", "-Command", "Write-Output 'A'"], { stdio: "pipe" });
let oA = ""; tA.stdout.on("data", d => oA += d);
tA.on("close", c => console.log("Test A (no env/cwd):", c, oA.trim()));

// Test B: env only
const env = { ...process.env, TEST_VAR: "1" };
const tB = spawn(PS, ["-NoProfile", "-Command", "Write-Output 'B'"], { env, stdio: "pipe" });
let oB = ""; tB.stdout.on("data", d => oB += d);
tB.on("close", c => console.log("Test B (env):", c, oB.trim()));

// Test C: cwd only
const tC = spawn(PS, ["-NoProfile", "-Command", "Write-Output 'C'"], { cwd: "C:\\", stdio: "pipe" });
let oC = ""; tC.stdout.on("data", d => oC += d);
tC.on("close", c => console.log("Test C (cwd C:\\):", c, oC.trim()));

await new Promise(r => setTimeout(r, 5000));
