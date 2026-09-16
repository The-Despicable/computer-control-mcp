// Latency harness. Run with the platform's own Node so the PowerShell pipe is
// native (on Windows: `node tests/scripts/bench.mjs`).
import { Mcp, parseToolResult, textJson } from "./mcp-client.mjs";

function stats(arr) {
  const a = arr.slice().sort((x, y) => x - y);
  const q = (p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  return { n: a.length, min: +a[0].toFixed(1), p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +a[a.length - 1].toFixed(1) };
}
async function time(fn) { const t = process.hrtime.bigint(); const r = await fn(); return { ms: Number(process.hrtime.bigint() - t) / 1e6, r }; }
const results = {};
async function bench(label, n, fn, warm = 1) {
  for (let i = 0; i < warm; i++) await fn();
  const xs = []; let last;
  for (let i = 0; i < n; i++) { const { ms, r } = await time(fn); xs.push(ms); last = r; }
  results[label] = stats(xs);
  console.log(label.padEnd(26), JSON.stringify(results[label]));
  return last;
}

const mcp = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: 'true', COMPUTER_CONTROL_LOG: 'error' });
try {
  await mcp.start();
  const wl = textJson(await mcp.callTool('window_list', {}));
  const fg = wl.foreground;
  console.log('platform:', process.platform, '| foreground:', fg.hwnd, fg.process, JSON.stringify(fg.title).slice(0, 50));

  await bench('window_list', 12, () => mcp.callTool('window_list', {}));
  await bench('observe(jpeg,1280)', 8, () => mcp.callTool('observe', { format: 'jpeg', max_dimension: 1280 }));
  await bench('observe(png,1924)', 6, () => mcp.callTool('observe', { format: 'png' }));
  await bench('observe(include_ui)', 5, () => mcp.callTool('observe', { format: 'jpeg', max_dimension: 800, include_ui: true }));
  await bench('window_focus(fg)', 10, () => mcp.callTool('window_focus', { hwnd: fg.hwnd }));
  await bench('find_text(uia,File)', 6, () => mcp.callTool('find_text', { text: 'File', engine: 'uia' }));
  await bench('find_element(name)', 6, () => mcp.callTool('find_element', { name: 'File' }));

  const base = parseToolResult(await mcp.callTool('observe', { max_dimension: 480 }));
  const sid = (base.json || {}).screen_id;
  const up = await bench('scroll(up,amt1)', 8, () => mcp.callTool('scroll', { screen_id: sid, direction: 'up', amount: 1 }));
  const sc = parseToolResult(up);
  console.log('  scroll image?', sc.image !== null, '| keys:', Object.keys(sc.json || {}).join(','));
  await bench('scroll(down,amt1)', 8, () => mcp.callTool('scroll', { screen_id: sid, direction: 'down', amount: 1 }));
  await bench('wait(100)', 3, () => mcp.callTool('wait', { duration_ms: 100 }), 0);
  await bench('find_text(ocr)', 3, () => mcp.callTool('find_text', { text: 'PowerShell', engine: 'ocr', limit: 3 }), 0);

  console.log('JSON=' + JSON.stringify(results));
} finally { mcp.stop(); }
