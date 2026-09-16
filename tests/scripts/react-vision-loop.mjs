import { spawn } from "node:child_process";
import { writeFileSync, appendFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Mcp, parseToolResult } from "./mcp-client.mjs";

// ReAct-text vision loop experiment (NO native tools param: NIM 400s tools+image).
// Model gets: screenshot (image_url) + prompt text. Model returns: exactly one
// JSON {action, reason, screen_id?, arguments?}. Harness validates + executes
// ONE MCP call, re-observes, repeats. MCP is the final authority on every call.
// Legs: A = screenshot + minimal metadata; B = screenshot + screen_id only.
const NIM_URL = process.env.NIM_URL || "https://integrate.api.nvidia.com/v1/chat/completions";
const NIM_MODEL = process.env.NIM_MODEL || "meta/llama-3.2-11b-vision-instruct";
const NIM_API_KEY = process.env.NIM_API_KEY || "";
const TRACE = "C:/gates/react-vision-trace.jsonl";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const parse = (r) => parseToolResult(r);
const ev = (rec) => { try { appendFileSync(TRACE, JSON.stringify({ t: new Date().toISOString(), ...rec }) + "\n"); } catch {} };

const ACTIONS = ["type", "key_press", "click", "wait", "observe", "find_text", "done"];
const MUT = new Set(["type", "key_press", "click"]);

async function chat(imageB64, promptText) {
  let lastErr = null;
  for (let a = 1; a <= 3; a++) {
    try {
      const body = { model: NIM_MODEL, max_tokens: 400, temperature: 0.0,
        messages: [{ role: "user", content: [
          { type: "text", text: promptText },
          { type: "image_url", image_url: { url: "data:image/png;base64," + imageB64 } },
        ]}]};
      const r = await fetch(NIM_URL, { method: "POST",
        headers: { "Authorization": `Bearer ${NIM_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = await r.json();
      return { text: j.choices?.[0]?.message?.content ?? "", usage: j.usage ?? null };
    } catch (e) { lastErr = e; ev({ kind: "transport_retry", attempt: a, error: String(e?.message ?? e).slice(0, 150) }); await sleep(4000); }
  }
  throw new Error(`model unreachable: ${String(lastErr?.message ?? lastErr).slice(0, 150)}`);
}

function parseAction(text) {
  const tryParse = (s) => { try { return JSON.parse(s); } catch { return null; } };
  let o = tryParse(text.trim());
  if (!o) { const m = text.match(/\{[\s\S]*\}/); if (m) o = tryParse(m[0]); }
  if (!o || typeof o !== "object") return { ok: false, error: "reply was not a JSON object" };
  if (!ACTIONS.includes(o.action)) return { ok: false, error: `unknown action ${JSON.stringify(o.action)}; use one of ${ACTIONS.join("|")}` };
  if (typeof o.reason !== "string" || !o.reason.trim()) return { ok: false, error: "missing reason (state the visual evidence you used)" };
  if (MUT.has(o.action) && typeof o.screen_id !== "string") return { ok: false, error: `action ${o.action} requires screen_id` };
  if (typeof o.arguments !== "object" || o.arguments === null) o.arguments = {};
  return { ok: true, value: o };
}

const TASK = "GOAL: make this terminal print the exact line REACT-VISION-OK. The shell is ready at a prompt. First type the text `echo REACT-VISION-OK` (type sends literal text only; Enter is NOT text), then send Enter with key_press, then verify the printed line is visible, then finish with done.";

async function runLeg(call, leg, termHwnd, maxTurns = 10) {
  // Fresh verified observation to open the leg.
  await call("window_focus", { hwnd: termHwnd });
  await sleep(600);
const FORMAT = `Reply with ONLY a JSON object. No prose, no fences, no markdown, no explanation outside the JSON. The object MUST have exactly these keys: action, reason, screen_id (for type/key_press/click only), arguments.
Valid action values (pick exactly one word): type, key_press, click, wait, observe, find_text, done.
EXAMPLE of a valid reply (adapt values to what YOU see; never copy these words verbatim):
{"action": "type", "reason": "The terminal shows a ready prompt and the goal line is absent, so I type the echo command.", "screen_id": "scr-9-abc12-3456", "arguments": {"text": "echo REACT-VISION-OK"}}
The screen_id value MUST be copied character-for-character from your Metadata/Protocol line. For done: {"action": "done", "reason": "I see the exact line REACT-VISION-OK printed in the terminal output.", "arguments": {"verdict": "achieved"}}. Never claim achieved unless the exact goal line is visible.`;
  const fresh = async () => {
    const wl = parse(await call("window_list", {}));
    const fg = (wl.json.windows ?? []).find(w => w.is_foreground);
    if (!fg || fg.hwnd !== termHwnd) return { interference: fg ? `${fg.title} (${fg.process})` : "<none>" };
    const ob = parse(await call("observe", { target: { window: termHwnd }, max_dimension: 1024 }));
    const cs = ob.raw?.content ?? [];
    const img = cs.find(c => c.type === "image");
    const meta = JSON.parse(cs.find(c => c.type === "text")?.text ?? "{}");
    return { sid: meta.screen_id, b64: img?.data ?? null, w: meta.image?.width, h: meta.image?.height, fgTitle: meta.foreground?.title, fgHwnd: meta.foreground?.hwnd };
  };
  let s0 = await fresh();
  if (s0.interference) return { leg, stopped: "OPERATOR_INTERFERENCE", detail: s0.interference };
  const turns = [];
  let current = s0, doneVerdict = null, repairs = 0;
  for (let turn = 1; turn <= maxTurns && !doneVerdict; turn++) {
    const metaLine = leg === "A"
      ? `Metadata: screen_id=${current.sid} (fresh, expires in 30s), foreground window title="${current.fgTitle}" HWND=${current.fgHwnd}.`
      : `Protocol: screen_id=${current.sid} (fresh, expires in 30s). No other metadata — use only the image.`;
    const prompt = `${TASK}\n${metaLine}\n${FORMAT}`;
    ev({ kind: "model_request", leg, turn, sid: current.sid, imgBytes: (current.b64 ?? "").length });
    let resp;
    try { resp = await chat(current.b64, prompt); }
    catch (e) { turns.push({ turn, error: `transport: ${e.message}` }); break; }
    ev({ kind: "model_response", leg, turn, text: resp.text, usage: resp.usage });
    let pa = parseAction(resp.text);
    if (!pa.ok && repairs < 1) {
      repairs++;
      ev({ kind: "json_repair", leg, turn, error: pa.error });
      try { resp = await chat(current.b64, `Your last reply was not valid JSON (${pa.error}). ${FORMAT}`); }
      catch (e) { turns.push({ turn, error: `transport on repair: ${e.message}` }); break; }
      ev({ kind: "model_response", leg, turn: turn + "-repair", text: resp.text });
      pa = parseAction(resp.text);
    }
    if (!pa.ok) { turns.push({ turn, raw: resp.text, error: pa.error }); break; }
    const a = pa.value;
    turns.push({ turn, action: a.action, reason: a.reason, arguments: a.arguments, raw: resp.text });
    ev({ kind: "action_chosen", leg, turn, action: a.action, reason: a.reason });
    if (a.action === "done") { doneVerdict = a.arguments?.verdict ?? "done"; break; }
    if (a.action === "observe") { /* model-requested re-observe: fall through to fresh below */ }
    else if (a.action === "wait") { await sleep(Math.min(10000, Number(a.arguments?.duration_ms) || 2000)); }
    else {
      const args = { ...a.arguments };
      if (MUT.has(a.action)) args.screen_id = a.screen_id; // model's sid, verbatim
      try {
        const res = await call(a.action, args, 90000);
        const text = (res?.content ?? []).filter(c => c.type === "text").map(c => c.text).join("\n").slice(0, 2000);
        let code = null; try { code = JSON.parse(text)?.error?.code ?? null; } catch {}
        turns[turns.length - 1].mcp = { code, result: text.slice(0, 800) };
        ev({ kind: "mcp_result", leg, turn, action: a.action, code, result: text.slice(0, 800) });
      } catch (e) {
        turns[turns.length - 1].mcp = { code: "TRANSPORT", result: String(e?.message ?? e).slice(0, 300) };
        ev({ kind: "mcp_result", leg, turn, action: a.action, code: "TRANSPORT" });
      }
    }
    await sleep(1500); // let the desktop settle so the next shot shows the effect
    current = await fresh();
    if (current.interference) return { leg, turns, stopped: "OPERATOR_INTERFERENCE", detail: current.interference };
    if (!current.b64) return { leg, turns, stopped: "OBSERVE_FAILED" };
  }
  return { leg, turns, doneVerdict, repairs };
}

let termA = null, termB = null, gated = null, finder = null;
const summary = { legs: [] };
try {
  if (!NIM_API_KEY) throw new Error("NIM_API_KEY empty");
  ev({ kind: "run_start", model: NIM_MODEL });
  const mk = (tag) => { const s = spawn("cmd.exe", ["/c", "start", `"${tag}"`, "cmd", "/K", `title ${tag}`], { shell: false, stdio: "ignore" }); if (typeof s.unref === "function") s.unref(); };
  const tagA = `cc-reactA-${Date.now()}`, tagB = `cc-reactB-${Date.now()}`;
  mk(tagA); await sleep(1200); mk(tagB); await sleep(2500);
  finder = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: "false", COMPUTER_CONTROL_LOG: "error" });
  await finder.start();
  for (let i = 0; i < 15 && (!termA || !termB); i++) {
    await sleep(800);
    const wl = parse(await finder.callTool("window_list", {}));
    if (!termA) { const t = wl.json.windows.find(w => String(w.title).includes(tagA)); if (t) termA = t; }
    if (!termB) { const t = wl.json.windows.find(w => String(w.title).includes(tagB)); if (t) termB = t; }
  }
  finder.stop(); finder = null;
  if (!termA || !termB) throw new Error(`leg terminals missing A=${!!termA} B=${!!termB}`);
  ev({ kind: "harness_ready", hwndA: termA.hwnd, hwndB: termB.hwnd });
  gated = new Mcp({ COMPUTER_CONTROL_INPUT_ENABLED: "true", COMPUTER_CONTROL_ALLOWED_PIDS: `${termA.pid},${termB.pid}`, COMPUTER_CONTROL_LOG: "error" });
  await gated.start();
  const call = (n, a, t) => gated.callTool(n, a, t);
  for (const leg of (process.env.REACT_LEGS || "B,A").split(",").map(s => s.trim()).filter(Boolean)) {
    ev({ kind: "leg_start", leg });
    summary.legs.push(await runLeg(call, leg, leg === "A" ? termA.hwnd : termB.hwnd));
  }
  // Independent verification per leg: fresh observe + find_text for the goal line (MCP reads, not model claims).
  for (const s of summary.legs) {
    if (s.stopped) { s.verified = false; continue; }
    const hwnd = s.leg === "A" ? termA.hwnd : termB.hwnd;
    try {
      await call("window_focus", { hwnd }); await sleep(600);
      const r = parse(await call("find_text", { text: "REACT-VISION-OK", scope: "foreground", limit: 3 }));
      const matches = (r.json.matches ?? []).filter(m => String(m.text ?? "").includes("REACT-VISION-OK"));
      s.verified = matches.length > 0;
      s.verifyDetail = `uiaOcrMatches=${matches.length}`;
    } catch (e) { s.verified = false; s.verifyDetail = `verify error: ${String(e?.message ?? e).slice(0, 150)}`; }
  }
  summary.t = new Date().toISOString();
  summary.model = NIM_MODEL;
  writeFileSync("C:/gates/react-vision-summary.json", JSON.stringify(summary, null, 1).slice(0, 500000));
  console.log(`REACT_DONE ${JSON.stringify(summary.legs.map(s => ({ leg: s.leg, done: s.doneVerdict ?? null, stopped: s.stopped ?? null, verified: s.verified ?? null })))}`);
} catch (e) {
  console.error(`REACT_ABORT ${e?.message ?? e}`);
  try { writeFileSync("C:/gates/react-vision-summary.json", JSON.stringify({ t: new Date().toISOString(), abort: String(e?.message ?? e).slice(0, 300), legs: summary.legs })); } catch {}
  process.exitCode = 1;
} finally {
  try { if (finder) finder.stop(); } catch {}
  try { if (gated) gated.stop(); } catch {}
  for (const t of [termA, termB]) {
    if (t) { try { const k = spawn("taskkill", ["/PID", String(t.pid), "/T", "/F"], { stdio: "ignore" }); if (typeof k.unref === "function") k.unref(); } catch {} }
  }
}
