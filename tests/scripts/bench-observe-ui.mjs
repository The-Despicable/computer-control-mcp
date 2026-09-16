import { Mcp, textJson } from "./mcp-client.mjs";
const mcp = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: 'true', COMPUTER_CONTROL_LOG: 'info', COMPUTER_CONTROL_TIMING: '1' });
try {
  await mcp.start();
  const wl = textJson(await mcp.callTool('window_list', {}));
  const target = (wl.windows || []).find(w => /File Explorer/i.test(w.title)) || (wl.windows || [])[0];
  console.log('target', target.hwnd, JSON.stringify(target.title));
  await mcp.callTool('window_focus', { hwnd: target.hwnd });
  for (let i = 0; i < 2; i++) await mcp.callTool('observe', { format: 'jpeg', max_dimension: 800, include_ui: true });
  console.log('--- timing (all) ---');
  console.log(mcp.stderr.split('\n').filter(l => /\[timing\]/.test(l)).join('\n'));
} finally { mcp.stop(); }
