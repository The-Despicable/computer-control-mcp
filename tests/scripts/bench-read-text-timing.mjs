import { Mcp, textJson } from "./mcp-client.mjs";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const mcp = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: 'true', COMPUTER_CONTROL_LOG: 'info', COMPUTER_CONTROL_TIMING: '1' });
async function ms(fn) { const t = Date.now(); const r = await fn(); return { ms: Date.now() - t, r }; }
try {
  await mcp.start();
  const wl = textJson(await mcp.callTool('window_list', {}));
  const wins = wl.windows || [];
  const term = wins.find(w => /Terminal/i.test(w.process)) || wins[0];
  const others = wins.filter(w => w.hwnd !== term.hwnd && w.title && !w.is_minimized).slice(0, 3);
  await mcp.callTool('window_focus', { hwnd: term.hwnd });

  const c = await ms(() => mcp.callTool('read_text', { offset: 0, limit: 1500 }));
  console.log('read_text COLD   ', JSON.stringify({ ms: c.ms, chars: textJson(c.r).returned_chars }));
  const w = await ms(() => mcp.callTool('read_text', { offset: 0, limit: 1500 }));
  console.log('read_text WARM   ', JSON.stringify({ ms: w.ms, chars: textJson(w.r).returned_chars }));

  for (const t of [term, ...others, term]) {
    await mcp.callTool('window_focus', { hwnd: t.hwnd });
    await sleep(50);
    const r = await ms(() => mcp.callTool('read_text', { offset: 0, limit: 1500 }));
    const j = textJson(r.r);
    console.log('read(%s)'.padEnd(22), JSON.stringify({ ms: r.ms, chars: j.returned_chars, source: j.source, title: j.target && j.target.title && j.target.title.slice(0, 24) }));
  }

  console.log('--- read_text timing lines ---');
  console.log(mcp.stderr.split('\n').filter(l => /read_text\.ps1|"tool":"read_text"/.test(l)).join('\n'));
} finally { mcp.stop(); }
