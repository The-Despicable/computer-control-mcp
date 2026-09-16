import { Mcp, parseToolResult, textJson } from "./mcp-client.mjs";
const mcp = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: 'true', COMPUTER_CONTROL_LOG: 'info', COMPUTER_CONTROL_TIMING: '1' });
try {
  await mcp.start();
  const wl = textJson(await mcp.callTool('window_list', {}));
  const fg = wl.foreground;
  await mcp.callTool('window_focus', { hwnd: fg.hwnd });
  await mcp.callTool('observe', { format: 'jpeg', max_dimension: 1280 });
  await mcp.callTool('find_text', { text: 'File', engine: 'uia' });
  await mcp.callTool('find_element', { name: 'File' });
  const obs = parseToolResult(await mcp.callTool('observe', { max_dimension: 480 }));
  const sid = (obs.json || {}).screen_id;
  await mcp.callTool('scroll', { screen_id: sid, direction: 'up', amount: 1 });
  await mcp.callTool('wait_for_text', { text: 'PowerShell', timeout_ms: 1500, poll_ms: 500 });
  console.log('--- [timing] lines ---');
  console.log(mcp.stderr.split('\n').filter(l => /\[timing\]/.test(l)).join('\n'));
} finally { mcp.stop(); }
