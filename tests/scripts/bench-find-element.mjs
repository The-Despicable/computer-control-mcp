// Deterministic find_element benchmark. Focuses a fixed target first, then runs
// the same search criteria repeatedly. Run on the native platform with a warm
// worker.
import { Mcp, textJson } from "./mcp-client.mjs";

function stats(a) {
  const s = a.slice().sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], p50: q(0.5), p95: q(0.95), max: s[s.length - 1] };
}
const mcp = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: 'true', COMPUTER_CONTROL_LOG: 'error' });
try {
  await mcp.start();
  const wl = textJson(await mcp.callTool('window_list', {}));
  const wins = wl.windows || [];
  const target = wins.find(w => /File Explorer/i.test(w.title))
    || wins.find(w => w.title && !w.is_minimized && w.hwnd !== (wl.foreground || {}).hwnd)
    || wins[0];
  console.log('target hwnd=%s pid=%s title=%s', target.hwnd, target.pid, JSON.stringify(target.title));
  await mcp.callTool('window_focus', { hwnd: target.hwnd });

  async function run(label, args, n) {
    for (let i = 0; i < 3; i++) await mcp.callTool('find_element', args); // warm
    const xs = [];
    for (let i = 0; i < n; i++) { const t = Date.now(); await mcp.callTool('find_element', args); xs.push(Date.now() - t); }
    console.log(label.padEnd(30), JSON.stringify(stats(xs)));
    return xs;
  }
  await run('find_element(name=File)', { name: 'File' }, 25);
  await run('find_element(nonexistent)', { name: 'zzz_no_such_zzz' }, 6);
  await run('find_element(control_type)', { control_type: 'button' }, 12);
} finally { mcp.stop(); }
