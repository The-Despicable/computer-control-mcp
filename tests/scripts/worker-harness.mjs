import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Mcp, parseToolResult } from "./mcp-client.mjs";

// Worker harness: a REAL external model drives the computer-control MCP itself.
// The harness NEVER performs the task: it only relays model tool calls to the
// MCP, returns MCP results verbatim, persists the trace, and verifies
// independently after the model stops. No auto-retry: every MCP error goes
// back to the model, which must recover on its own.

const NIM_URL = process.env.NIM_URL || "https://integrate.api.nvidia.com/v1/chat/completions";
const NIM_MODEL = process.env.NIM_MODEL || "deepseek-ai/deepseek-v4-flash-0731";
const NIM_API_KEY = process.env.NIM_API_KEY || "";
const MAX_TURNS = Number(process.env.WORKER_MAX_TURNS || 45);

const TURNS_FILE = "C:/gates/worker-turns.jsonl";
const RESULT_FILE = "C:/gates/worker-result.json";
const TRANSCRIPT_FILE = "C:/gates/worker-transcript.json";

let failures = 0;
const event = (rec) => {
  const line = JSON.stringify({ t: new Date().toISOString(), ...rec });
  try { appendFileSync(TURNS_FILE, line + "\n"); } catch {}
  return rec;
};

const dir = mkdtempSync(join(tmpdir(), "cc-worker-"));
const runTag = `worker-${Date.now()}`;
const wdir = dir.replace(/\\/g, "/");
writeFileSync(join(dir, "math.js"), `// ${runTag}\nfunction add(a, b) {\n  return a - b; // BUG: should be a + b\n}\nmodule.exports = { add };\n`);
writeFileSync(join(dir, "run.js"),
  "const { add } = require('./math.js');\n" +
  "if (add(2, 3) === 5) { console.log('ALL TESTS PASSED'); process.exit(0); }\n" +
  "console.log('FAIL: add(2,3) returned ' + add(2, 3) + ', expected 5'); process.exit(1);\n");

const SYSTEM = `You are a worker driving a Windows desktop through MCP tools to complete a bounded coding task. You are TEXT-ONLY: screenshot images are withheld from you; you perceive via structured tool results (window lists, text matches, wait results, metadata).

TASK: In ${wdir}, math.js exports add(a,b) but it is buggy. Fix math.js so that running node run.js in ${wdir} prints ALL TESTS PASSED. Files: math.js (fix this), run.js (test runner, do NOT modify). The file's first line is a marker comment // ${runTag} — use find_text on it to confirm you are editing YOUR tab before changing anything.

ENVIRONMENT: A terminal window titled TERM_PLACEHOLDER and a Notepad window are already open. Input is allowlisted to those two windows only; other windows refuse input. The shell's starting folder is NOT the project folder — navigate or use full paths. In typed commands use forward slashes, e.g. node "${wdir}/run.js".

RULES:
- Every mutation (click/type/key_press) needs a FRESH screen_id from a recent window_list/observe/find_text/find_element/window_focus result. Stale ids fail; re-observe and retry differently.
- To click: use find_text match centers with space 'desktop', or window bounds centers (bounds.x+bounds.w/2, bounds.y+bounds.h/2 from window_list). Never guess coordinates.
- type sends literal text only (Enter is NOT text — use key_press with keys 'enter'). Save with key_press keys 'ctrl+s'. Select-all is key_press keys 'ctrl+a'.
- After editing in Notepad, confirm YOUR marker plus the new code via find_text BEFORE saving.
- Confirm test output via wait_for_text or find_text on the terminal (engine auto, generous timeouts). Re-run the command if output is unclear.
- On ANY error result: read its code/message, re-observe, and choose a DIFFERENT action. Never blindly repeat a failed call.
- When run.js prints ALL TESTS PASSED and the fix is saved to disk, reply with a line containing only DONE plus a short summary. Your DONE message is not the verdict — an independent checker verifies the files and reruns the tests itself.`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const parse = (r) => parseToolResult(r);
const extractText = (res) => (res?.content ?? []).filter(c => c.type === "text").map(c => c.text).join("\n").slice(0, 6000);
const screenOf = (j) => j?.screen_id ?? j?.result?.screen_id ?? null;
const errOf = (j) => j?.error?.code ?? null;

async function chat(messages, tools) {
  // Model-transport resilience only: bounded retries of the HTTP call itself.
  // NEVER fabricates MCP actions — a failed turn is retried, never answered.
  let lastErr = null;
  for (let a = 1; a <= 3; a++) {
    try {
      const r = await fetch(NIM_URL, {
        method: "POST",
        headers: { "Authorization": `Bearer ${NIM_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: NIM_MODEL, messages, tools, tool_choice: "auto", max_tokens: 2000, temperature: 0.2 }),
        signal: AbortSignal.timeout(90000),
      });
      if (!r.ok) throw new Error(`model HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
      const j = await r.json();
      return j.choices?.[0]?.message ?? {};
    } catch (e) {
      lastErr = e;
      event({ kind: "model_transport_retry", attempt: a, error: String(e && e.message ? e.message : e).slice(0, 200) });
      await sleep(5000);
    }
  }
  throw new Error(`model unreachable after 3 attempts: ${String(lastErr && lastErr.message ? lastErr.message : lastErr).slice(0, 200)}`);
}
let termPid = null, notePid = null;
let finder = null, gated = null;
let preExistingNote = new Set();
const messages = [];
try {
  event({ kind: "run_start", runTag, model: NIM_MODEL, dir: "<tmp>" });

  const preNote = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: "false", COMPUTER_CONTROL_LOG: "error" });
  await preNote.start();
  try {
    preExistingNote = new Set((parse(await preNote.callTool("window_list", {}))).json?.windows
      ?.filter(w => String(w.process).toLowerCase().includes("notepad")).map(w => w.pid) ?? []);
  } finally { try { preNote.stop(); } catch {} }
  const termTitle = `cc-worker-term-${Date.now()}`;
  const termStub = spawn("cmd.exe", ["/c", "start", `"${termTitle}"`, "cmd", "/K", `title ${termTitle}`], { shell: false, stdio: "ignore" });
  if (typeof termStub.unref === "function") termStub.unref();
  const earlyNote = spawn("notepad.exe", [join(dir, "math.js")], { stdio: "ignore" });
  if (typeof earlyNote.unref === "function") earlyNote.unref();
  await sleep(3000);

  finder = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: "false", COMPUTER_CONTROL_LOG: "error" });
  await finder.start();
  for (let i = 0; i < 20 && (!termPid || !notePid); i++) {
    await sleep(750);
    const wl = parse(await finder.callTool("window_list", {}));
    if (!termPid) {
      const t = wl.json.windows.find(w => String(w.title).includes(termTitle));
      if (t) termPid = t.pid;
    }
    if (!notePid) {
      const n = wl.json.windows.find(w => !w.is_minimized &&
        String(w.process).toLowerCase().includes("notepad") && String(w.title).includes("math"));
      if (n) notePid = n.pid;
    }
  }
  finder.stop(); finder = null;
  if (!termPid || !notePid) throw new Error(`harness windows missing term=${termPid} note=${notePid}`);
  event({ kind: "harness_ready", termPid, notePid });

  gated = new Mcp({
    COMPUTER_CONTROL_INPUT_ENABLED: "true",
    COMPUTER_CONTROL_ALLOWED_PIDS: `${termPid},${notePid}`,
    COMPUTER_CONTROL_LOG: "error",
  });
  await gated.start();

  const listed = await gated.listTools();
  const mcpTools = listed?.tools ?? listed?.result?.tools ?? [];
  event({ kind: "tools_list", count: mcpTools.length, names: mcpTools.map(t => t.name) });
  const oaiTools = mcpTools.map(t => ({
    type: "function",
    function: {
      name: t.name,
      description: String(t.description || t.title || t.name).slice(0, 1500),
      parameters: (t.inputSchema && t.inputSchema.type === "object") ? t.inputSchema : { type: "object", properties: {} },
    },
  }));

  messages.push({ role: "system", content: SYSTEM.replace("TERM_PLACEHOLDER", termTitle) });
  messages.push({ role: "user", content: "Begin the task." });

  let done = false, nudges = 0, modelCalls = 0, mcpCalls = 0, recoveries = 0;
  let lastFailed = false;
  for (let turn = 1; turn <= MAX_TURNS && !done; turn++) {
    const reqMsg = messages.slice();
    event({ kind: "model_request", turn, nMessages: reqMsg.length });
    const msg = await chat(reqMsg, oaiTools);
    modelCalls++;
    event({ kind: "model_response", turn, finish: msg.finish_reason ?? null, content: (msg.content || "").slice(0, 2000), tool_calls: (msg.tool_calls ?? []).map(c => ({ id: c.id, name: c.function?.name, args: (c.function?.arguments || "").slice(0, 1000) })) });
    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: msg.tool_calls ?? undefined });

    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) {
      if (/^\s*DONE\b/im.test(msg.content || "")) { done = true; break; }
      if (++nudges > 2) { event({ kind: "abort", reason: "model stopped calling tools without DONE" }); break; }
      messages.push({ role: "user", content: "Continue: use MCP tools to advance the task, or reply DONE only when run.js prints ALL TESTS PASSED and the fix is saved." });
      continue;
    }
    for (const c of calls) {
      const name = c.function?.name;
      let args = {};
      try { args = JSON.parse(c.function?.arguments || "{}"); }
      catch { messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify({ ok: false, error: { code: "BAD_ARGS", message: "arguments were not valid JSON; retry with corrected JSON" } }) }); continue; }
      mcpCalls++;
      let content, code = null, sid = null;
      try {
        const res = await gated.callTool(name, args, 90000);
        const text = extractText(res);
        try { const j = JSON.parse(text); code = errOf(j); sid = screenOf(j); } catch {}
        content = text || "(empty MCP result)";
        event({ kind: "mcp_call", turn, tool: name, args, code, screen_id: sid, result: content.slice(0, 3000), image_withheld: true });
      } catch (e) {
        code = "TRANSPORT";
        content = JSON.stringify({ ok: false, error: { code, message: String(e && e.message ? e.message : e).slice(0, 500) } });
        event({ kind: "mcp_call", turn, tool: name, args, code, screen_id: null, result: content });
      }
      if (code && lastFailed === false) { /* failure noted; recovery judged below */ }
      if (lastFailed && code === null) recoveries++;
      lastFailed = !!code;
      messages.push({ role: "tool", tool_call_id: c.id, content });
    }
  }
  event({ kind: "loop_end", done, modelCalls, mcpCalls, recoveries });

  // Worker is cut off here: no further actions allowed. Independent verification.
  let verdict = "NOT VERIFIED", detail = "";
  try {
    const math = readFileSync(join(dir, "math.js"), "utf8");
    const diskOk = math.includes("return a + b") && math.includes(runTag);
    const out = await new Promise((res) => {
      const p = spawn("node", ["run.js"], { cwd: dir, shell: false });
      let o = "";
      if (p.stdout) p.stdout.on("data", d => { o += d; });
      if (p.stderr) p.stderr.on("data", d => { o += d; });
      p.on("close", () => res(o));
    });
    const passOk = out.includes("ALL TESTS PASSED");
    if (done && diskOk && passOk) { verdict = "VERIFIED COMPLETE"; }
    detail = `done=${done} diskFix=${diskOk} testsPass=${passOk} out=${out.slice(0, 120)}`;
  } catch (e) { detail = `verify error: ${String(e && e.message ? e.message : e).slice(0, 200)}`; }
  event({ kind: "verification", verdict, detail });
  try { writeFileSync(RESULT_FILE, JSON.stringify({ t: new Date().toISOString(), runTag, model: NIM_MODEL, verdict, detail }) + "\n"); } catch {}
  try { writeFileSync(TRANSCRIPT_FILE, JSON.stringify({ runTag, model: NIM_MODEL, messages }, null, 1).slice(0, 2000000)); } catch {}
  console.log(`WORKER_RESULT ${JSON.stringify({ verdict, runTag })}`);
  console.log(detail);
  if (verdict !== "VERIFIED COMPLETE") process.exitCode = 1;
} catch (e) {
  failures++;
  console.error(`WORKER_ABORT ${(e && e.message ? e.message : e)}`);
  try { writeFileSync(RESULT_FILE, JSON.stringify({ t: new Date().toISOString(), runTag, verdict: "NOT VERIFIED", detail: `abort: ${String(e && e.message ? e.message : e).slice(0, 300)}` }) + "\n"); } catch {}
  console.log(`WORKER_RESULT ${JSON.stringify({ verdict: "NOT VERIFIED", runTag })}`);
  process.exitCode = 1;
} finally {
  try { if (finder) finder.stop(); } catch {}
  try { if (gated) gated.stop(); } catch {}
  if (termPid) { try { const k = spawn("taskkill", ["/PID", String(termPid), "/T", "/F"], { stdio: "ignore" }); if (typeof k.unref === "function") k.unref(); } catch {} }
  if (notePid && !preExistingNote.has(notePid)) { try { const k = spawn("taskkill", ["/PID", String(notePid), "/T", "/F"], { stdio: "ignore" }); if (typeof k.unref === "function") k.unref(); } catch {} }
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}
