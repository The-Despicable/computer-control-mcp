import { Mcp, parseToolResult, textJson } from "./mcp-client.mjs";
const mcp = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: 'true', COMPUTER_CONTROL_LOG: 'error' });
async function ms(fn) { const t = Date.now(); const r = await fn(); return { ms: Date.now() - t, r }; }
try {
  await mcp.start();
  const tools = (await mcp.listTools()).tools.map(t => t.name);
  console.log('tools=%d read_text=%s', tools.length, tools.includes('read_text'));

  const wl = textJson(await mcp.callTool('window_list', {}));
  const wins = wl.windows || [];
  const term = wins.find(w => /Terminal/i.test(w.process)) || wins.find(w => /PowerShell/i.test(w.title)) || wins[0];
  const other = wins.find(w => /File Explorer/i.test(w.title));
  console.log('term=%d %s', term.hwnd, JSON.stringify(term.title));
  await mcp.callTool('window_focus', { hwnd: term.hwnd });

  const p1 = await ms(() => mcp.callTool('read_text', { offset: 0, limit: 2000 }));
  const j1 = textJson(p1.r);
  console.log('read_text(0,2000)', JSON.stringify({ ms: p1.ms, chars: j1.returned_chars, total: j1.total_known, trunc: j1.truncated, source: j1.source, ctype: j1.control_type, head: (j1.text || '').slice(0, 50).replace(/\s+/g, ' ') }));

  const next = j1.returned_chars || 0;
  const p2 = await ms(() => mcp.callTool('read_text', { offset: next, limit: 2000 }));
  const j2 = textJson(p2.r);
  console.log('read_text(next,2000)', JSON.stringify({ ms: p2.ms, chars: j2.returned_chars, trunc: j2.truncated }));

  const p3 = await ms(() => mcp.callTool('read_text', { offset: 100000, limit: 100 }));
  const j3 = textJson(p3.r);
  console.log('read_text(100000,100)', JSON.stringify({ ms: p3.ms, chars: j3.returned_chars, trunc: j3.truncated }));

  // screen_id binding + FOREGROUND_CHANGED
  const obs = parseToolResult(await mcp.callTool('observe', { max_dimension: 480 }));
  const sid = (obs.json || {}).screen_id;
  if (other) {
    await mcp.callTool('window_focus', { hwnd: other.hwnd });
    const bad = textJson(await mcp.callTool('read_text', { screen_id: sid }));
    console.log('read_text(stale sid)', JSON.stringify({ ok: bad.ok, code: bad.error && bad.error.code }));
    await mcp.callTool('window_focus', { hwnd: term.hwnd });
  }

  // Long-content workflow comparison: observe+scroll+observe (with restore)
  const t0 = Date.now();
  const o1 = parseToolResult(await mcp.callTool('observe', { format: 'jpeg', max_dimension: 1280 }));
  const s1 = textJson(await mcp.callTool('scroll', { screen_id: o1.json.screen_id, direction: 'down', amount: 3 }));
  const o2 = parseToolResult(await mcp.callTool('observe', { format: 'jpeg', max_dimension: 1280 }));
  const t1 = Date.now();
  await mcp.callTool('scroll', { screen_id: s1.screen_id, direction: 'up', amount: 3 });
  console.log('observe+scroll+observe', JSON.stringify({ ms: t1 - t0, bytes: o1.image.data.length + o2.image.data.length, calls: 3 }));
  console.log('read_text x1 bytes~', JSON.stringify({ bytes: (j1.text || '').length }));
} finally { mcp.stop(); }
