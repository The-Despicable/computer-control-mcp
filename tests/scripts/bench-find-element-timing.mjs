import { Mcp, textJson } from "./mcp-client.mjs";
const mcp = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: 'true', COMPUTER_CONTROL_LOG: 'info', COMPUTER_CONTROL_TIMING: '1' });
try {
  await mcp.start();
  const wl = textJson(await mcp.callTool('window_list', {}));
  const target = (wl.windows || []).find(w => /File Explorer/i.test(w.title)) || (wl.windows || [])[0];
  console.log('target', target.hwnd, JSON.stringify(target.title));
  await mcp.callTool('window_focus', { hwnd: target.hwnd });
  for (let i = 0; i < 3; i++) await mcp.callTool('find_element', { name: 'File' });
  console.log('--- timing (all) ---');
  const lines = mcp.stderr.split('\n').filter(l => /\[timing\]/.test(l));
  console.log(lines.join('\n'));
} finally { mcp.stop(); }
