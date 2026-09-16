import { execSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
execSync("npx tsc -p tsconfig.json", { stdio: "inherit" });
cpSync("src/windows-backend/scripts", "dist/src/windows-backend/scripts", { recursive: true });
console.error("[build] tsc done; PowerShell helpers copied to dist/src/windows-backend/scripts");
