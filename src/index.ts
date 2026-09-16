import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { createCtx } from "./deps.js";
import { Policy } from "./core/policy.js";
import { PowershellBackend } from "./windows-backend/powershell.js";
import { TOOLS } from "./tools/index.js";
import { loadEnvFile, log } from "./core/util.js";

// stdout belongs to MCP stdio. All non-protocol output goes to stderr. Guard first.
const guard = (...a: unknown[]) => console.error("[stdout-guard]", ...a);
console.log = guard;
console.info = guard;
console.debug = guard;
console.warn = guard;
console.trace = guard;

async function main() {
  loadEnvFile();
  const policy = Policy.load();
  const backend = new PowershellBackend();
  backend.selfCheck(); // missing helpers = loud failure, exit(1) — never a silent clean exit

  // Truthful startup capability probe: reports platform / PowerShell / helpers /
  // OCR instead of failing later on the first tool call. A non-Windows host is
  // reported as backend_ready:false and tools keep returning structured errors.
  const report = await backend.probeCapabilities();
  if (!report.backend_ready) {
    log(report.windows ? "error" : "info", "computer-control backend not ready", report);
    if (process.env.COMPUTER_CONTROL_REQUIRE_WINDOWS === "true" && report.windows) {
      throw new Error(`Windows backend not ready: ${report.detail}`);
    }
  }

  const ctx = createCtx({ backend, policy });
  const server = createServer(ctx);
  await server.connect(new StdioServerTransport());

  log("info", "computer-control MCP ready", {
    entry: pathToFileURL(process.argv[1] ?? "unknown").href,
    input_enabled: policy.inputEnabled,
    tools: TOOLS.length,
    observation_max_age_ms: policy.maxObservationAgeMs,
    backend_ready: report.backend_ready,
    powershell: report.powershell.version,
    ocr: report.ocr,
  });

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    log("info", `shutting down (${signal}); closing PowerShell pool`);
    try { await backend.close(); } catch { /* best effort */ }
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch(err => {
  console.error("[computer-control] FATAL startup failure:", err);
  process.exit(1); // startup failures must never masquerade as a clean exit
});

process.on("unhandledRejection", r => {
  console.error("[computer-control] unhandled rejection:", r);
  process.exit(1);
});
