import { Mcp, parseToolResult, textJson } from "./mcp-client.mjs";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const mcp = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: 'true', COMPUTER_CONTROL_LOG: 'error' });
async function ms(fn) { const t = Date.now(); await fn(); return Date.now() - t; }
try {
  await mcp.start();
  const wl = textJson(await mcp.callTool('window_list', {}));
  const fg = wl.foreground;

  // Solo baselines
  const soloList = await ms(() => mcp.callTool('window_list', {}));
  const soloObs = await ms(() => mcp.callTool('observe', { format: 'jpeg', max_dimension: 800 }));
  const soloFocus = await ms(() => mcp.callTool('window_focus', { hwnd: fg.hwnd }));

  // Start a slow perception wait (will time out) and drive other windows meanwhile
  const waitP = mcp.callTool('wait_for_text', { text: 'zzz_no_such_text_zzz', timeout_ms: 5000, poll_ms: 500 }).catch(() => null);
  await sleep(300);
  const conList = await ms(() => mcp.callTool('window_list', {}));
  const conFocus = await ms(() => mcp.callTool('window_focus', { hwnd: fg.hwnd }));
  const conObs = await ms(() => mcp.callTool('observe', { format: 'jpeg', max_dimension: 800 }));
  await waitP;

  console.log(JSON.stringify({
    solo: { window_list: soloList, window_focus: soloFocus, observe: soloObs },
    during_slow_wait: { window_list: conList, window_focus: conFocus, observe: conObs },
  }, null, 2));
} finally { mcp.stop(); }
