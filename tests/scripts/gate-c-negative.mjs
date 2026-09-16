import { Mcp, errCode, textJson, PASS, FAIL_, spawnPowershell } from "./mcp-client.mjs";

let failures = 0;
const check = (name, cond, why) => { cond ? PASS(name) : (failures++, FAIL_(name, why)); };

// Server A: observe-only (default) -> POLICY_DENIED
const A = new Mcp({ COMPUTER_CONTROL_LOG: "error" });
// Server B: input enabled, short observation age for staleness tests. NO input should ever succeed here.
const B = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: "true", COMPUTER_CONTROL_MAX_OBSERVATION_AGE_MS: "900", COMPUTER_CONTROL_LOG: "error" });
// Server B2: input enabled, long observation age for C10 (the harness-side focus
// change via a fresh powershell spawn takes longer than B's 900ms staleness window).
const B2 = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: "true", COMPUTER_CONTROL_MAX_OBSERVATION_AGE_MS: "30000", COMPUTER_CONTROL_LOG: "error" });

try {
  await A.start(); await B.start(); await B2.start();
  const obsB = textJson(await B.callTool("observe", {}));
  const sid = obsB.screen_id;

  check("C1 click without screen_id -> NO_OBSERVATION", errCode(await B.callTool("click", { x: 10, y: 10 })) === "NO_OBSERVATION");
  check("C2 click with unknown screen_id -> STALE_SCREEN", errCode(await B.callTool("click", { screen_id: "scr-999999-x-dead", x: 10, y: 10 })) === "STALE_SCREEN");
  check("C3 key_press unknown key -> UNKNOWN_KEY", errCode(await B.callTool("key_press", { screen_id: sid, keys: "ctrl+notakey" })) === "UNKNOWN_KEY");
  check("C4 key_press chord with only modifiers -> INVALID_ARGUMENT", errCode(await B.callTool("key_press", { screen_id: sid, keys: "ctrl+shift" })) === "INVALID_ARGUMENT");
  check("C5 click off-image coords -> INVALID_COORDINATE", errCode(await B.callTool("click", { screen_id: sid, x: 999999, y: 999999 })) === "INVALID_COORDINATE");
  check("C6 click in dead desktop space -> INVALID_COORDINATE", errCode(await B.callTool("click", { screen_id: sid, x: -99999, y: -99999, space: "desktop" })) === "INVALID_COORDINATE");
  check("C7 window_focus bogus hwnd -> WINDOW_NOT_FOUND", errCode(await B.callTool("window_focus", { hwnd: 987654321 })) === "WINDOW_NOT_FOUND");
  check("C8 wait_for_text bogus text -> TIMEOUT (no false success)", errCode(await B.callTool("wait_for_text", { text: "zz_no_such_text_qq_12345", timeout_ms: 1200, poll_ms: 300 })) === "TIMEOUT");

  // C9 aged observation -> STALE_SCREEN
  await new Promise(r => setTimeout(r, 1200));
  check("C9 click on aged screen_id -> STALE_SCREEN", errCode(await B.callTool("click", { screen_id: sid, x: 10, y: 10 })) === "STALE_SCREEN");

  // C10 foreground change between observe and click -> FOREGROUND_CHANGED, input NOT sent.
  // The harness launches its OWN notepad (new GUI processes take foreground at
  // startup, unlike SetForegroundWindow from a background PS host which the OS
  // foreground lock denies). The MCP sends nothing in this check.
  const obsB2 = textJson(await B2.callTool("observe", {}));
  const stealPid = await spawnPowershell("(Start-Process notepad.exe -PassThru).Id; Start-Sleep -Milliseconds 1500");
  const c10code = errCode(await B2.callTool("click", { screen_id: obsB2.screen_id, x: 10, y: 10 }));
  await spawnPowershell(`Stop-Process -Id ${stealPid.trim()} -Force`);
  check("C10 click after harness-side focus change -> FOREGROUND_CHANGED", c10code === "FOREGROUND_CHANGED", `got ${c10code}`);

  // C11 POLICY_DENIED on observe-only server
  const obsA = textJson(await A.callTool("observe", {}));
  check("C11 click on observe-only server -> POLICY_DENIED", errCode(await A.callTool("click", { screen_id: obsA.screen_id, x: 10, y: 10 })) === "POLICY_DENIED");
  check("C11b window_focus on observe-only server -> POLICY_DENIED", errCode(await A.callTool("window_focus", { hwnd: 1 })) === "POLICY_DENIED");

  console.log(failures === 0 ? "\nGATE C: ALL PASS (zero real MCP input)" : `\nGATE C: ${failures} FAILURES`);
  if (failures > 0) process.exitCode = 1;
} finally { A.stop(); B.stop(); B2.stop(); }
