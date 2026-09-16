import { Mcp, errCode, textJson, PASS, FAIL_ } from "./mcp-client.mjs";

// C12: allowlist holds a REAL pid (this harness process) that is never the
// foreground window owner -> click must fail POLICY_DENIED pre-injection.
const mcp = new Mcp({
  COMPUTER_CONTROL_INPUT_ENABLED: "true",
  COMPUTER_CONTROL_ALLOWED_PIDS: String(process.pid),
  COMPUTER_CONTROL_LOG: "error",
});
try {
  await mcp.start();
  const obs = textJson(await mcp.callTool("observe", {}));
  const code = errCode(await mcp.callTool("click", { screen_id: obs.screen_id, x: 10, y: 10, space: "desktop" }));
  if (code === "POLICY_DENIED") PASS("C12 allowlist denies non-allowed foreground PID (pre-injection)");
  else { FAIL_("C12", `expected POLICY_DENIED, got ${code}`); }
} finally { mcp.stop(); }
