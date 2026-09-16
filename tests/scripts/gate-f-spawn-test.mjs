import { spawn } from "node:child_process";

const PS = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";
console.log("Testing spawn...");

const p = spawn(PS, ["-NoProfile", "-Command", "Write-Output 'hello'"], { stdio: "pipe" });
let out = "";
p.stdout.setEncoding("utf8").on("data", d => { out += d; console.log("DATA:", d.trim()); });
p.stderr.setEncoding("utf8").on("data", d => console.log("STDERR:", d.trim()));
p.on("error", e => console.log("ERROR:", e.message, e.code));
p.on("close", c => console.log("EXIT:", c, "OUT:", out.trim()));
