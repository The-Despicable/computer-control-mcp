import test from "node:test";
import assert from "node:assert/strict";
import { createCtx, bindPerceptionOutcome, type Backend, type Ctx, type CurrentUiState, type CaptureResult, type PerceiveOutcome, type WindowsResult, type WindowEntry } from "../../src/deps.js";
import { Policy } from "../../src/core/policy.js";
import { ToolError, toToolError } from "../../src/core/errors.js";
import { click, keyPress, type as typeTool } from "../../src/tools/input.js";
import { waitForText, waitForChange } from "../../src/tools/wait.js";
import { observe, windowFocus } from "../../src/tools/observation.js";
import { findText } from "../../src/tools/perception.js";
import type { ToolDef } from "../../src/tools/index.js";

function liveState(): CurrentUiState {
  return {
    monitors: [{ index: 0, x: 0, y: 0, w: 1920, h: 1080, scale: 1, primary: true, device: "d" }],
    virtual_screen: { x: 0, y: 0, w: 1920, h: 1080 },
    foreground: { hwnd: 42, pid: 777, process: "app", title: "App", bounds: { x: 10, y: 10, w: 800, h: 600 } },
    cursor: { x: 5, y: 5 }, timestamp: Date.now(),
  };
}

class FakeBackend implements Backend {
  live: CurrentUiState = liveState();
  inputCalls: unknown[] = [];
  focusCalls: number[] = [];
  failInput: { code: ToolError["code"]; message: string } | null = null;
  perceiveResp: { matches: PerceiveOutcome["matches"] } = { matches: [] };
  capThumb = Buffer.alloc(64, 128).toString("base64");

  async capture(req: { thumbprint_only?: boolean }): Promise<CaptureResult> {
    const s = this.live;
    return {
      ...s,
      screenshot_b64: req?.thumbprint_only ? null : Buffer.alloc(64).toString("base64"),
      format: "png", width: 960, height: 540, origin: { x: 0, y: 0 }, scale: 1,
      region: { x: 0, y: 0, w: 1920, h: 1080 }, thumbprint_b64: this.capThumb,
    };
  }
  async state(): Promise<CurrentUiState> { return this.live; }
  async windows(): Promise<WindowsResult> {
    const fg = this.live.foreground;
    return {
      ...this.live,
      windows: fg ? [{ hwnd: fg.hwnd, pid: fg.pid, process: fg.process, title: fg.title,
        bounds: fg.bounds, is_foreground: true, is_minimized: false, z: 0 }] : [],
    };
  }
  async focus(hwnd: number): Promise<CurrentUiState> {
    this.focusCalls.push(hwnd);
    return this.live;
  }
  async windowInfo(hwnd: number): Promise<WindowEntry> {
    const fg = this.live.foreground;
    if (!fg || fg.hwnd !== hwnd) throw new ToolError("WINDOW_NOT_FOUND", `no visible top-level window with hwnd ${hwnd}`);
    return { hwnd: fg.hwnd, pid: fg.pid, process: fg.process, title: fg.title, bounds: fg.bounds, is_foreground: true, is_minimized: false, z: 0 };
  }
  async readText(): Promise<{ text: string; complete: boolean; source: "text" | "value" | "none"; control_type: string | null; chars: number; identity: { hwnd: number; start_pid: number; end_pid: number; window_valid: boolean }; target: null }> {
    return { text: "", complete: true, source: "none", control_type: null, chars: 0, identity: { hwnd: 0, start_pid: 0, end_pid: 0, window_valid: true }, target: null };
  }
  async perceive(): Promise<PerceiveOutcome> {
    return { ...this.live, mode: "text", matches: this.perceiveResp.matches, engines_used: ["uia"], ocr_available: false, truncated: false };
  }
  inputExtra: { clipboard_restored?: boolean } = {};
  async input(req: unknown): Promise<{ state: CurrentUiState; clipboard_restored?: boolean }> {
    this.inputCalls.push(req);
    const failed = this.failInput;
    if (failed) throw new ToolError(failed.code, failed.message);
    return { state: this.live, ...this.inputExtra };
  }
}

function ctxWith(inputEnabled = true): { ctx: Ctx; backend: FakeBackend } {
  const saved = process.env.COMPUTER_CONTROL_INPUT_ENABLED;
  process.env.COMPUTER_CONTROL_INPUT_ENABLED = inputEnabled ? "true" : "false";
  const policy = Policy.load();
  if (saved === undefined) delete process.env.COMPUTER_CONTROL_INPUT_ENABLED;
  else process.env.COMPUTER_CONTROL_INPUT_ENABLED = saved;
  const backend = new FakeBackend();
  return { ctx: createCtx({ backend, policy }), backend };
}

async function run(tool: ToolDef, ctx: Ctx, args: unknown) {
  return tool.handler(ctx, args);
}

async function errOf(p: Promise<unknown>): Promise<string | null> {
  try { await p; return null; } catch (e: unknown) { return toToolError(e).code; }
}

function textJson(r: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const t = r.content.find(c => c.type === "text");
  const text: unknown = t?.text ?? "{}";
  return JSON.parse(typeof text === "string" ? text : "{}");
}

test("observe returns real MCP image content and no path", async () => {
  const { ctx } = ctxWith();
  const r = await run(observe, ctx, {});
  const first = r.content[0];
  assert.equal(first?.type, "image");
  if (first?.type !== "image") throw new Error("expected image");
  assert.ok(first.data.length > 10);
  assert.equal(first.mimeType, "image/png");
  assert.ok(!JSON.stringify(r.content).includes("path"));
  assert.ok(typeof textJson(r).screen_id === "string");
});

test("click: NO_OBSERVATION / STALE_SCREEN / POLICY_DENIED / INVALID_COORDINATE / happy path", async () => {
  const { ctx, backend } = ctxWith();
  assert.equal(await errOf(run(click, ctx, { x: 5, y: 5 })), "NO_OBSERVATION");
  assert.equal(await errOf(run(click, ctx, { screen_id: "scr-1-z-zzzz", x: 5, y: 5 })), "STALE_SCREEN");
  const obs = textJson(await run(observe, ctx, {}));
  ctx.policy.inputEnabled = false; // same store: id is known, so the policy gate is what fires
  assert.equal(await errOf(run(click, ctx, { screen_id: obs.screen_id, x: 5, y: 5 })), "POLICY_DENIED");
  ctx.policy.inputEnabled = true;
  assert.equal(await errOf(run(click, ctx, { screen_id: obs.screen_id, x: 99999, y: 0 })), "INVALID_COORDINATE");
  const r = await run(click, ctx, { screen_id: obs.screen_id, x: 100, y: 100 });
  const sent: unknown = backend.inputCalls.at(-1);
  assert.ok(sent && typeof sent === "object" && "action" in sent && sent.action === "click");
  assert.ok(sent && typeof sent === "object" && "expect" in sent);
  const expectVal: unknown = sent.expect;
  assert.ok(expectVal && typeof expectVal === "object" && "foreground_hwnd" in expectVal);
  assert.equal(expectVal.foreground_hwnd, 42); // the in-process gate receives the bound HWND
  assert.ok(textJson(r).screen_id);
});

test("click: FOREGROUND_CHANGED from backend pre-injection gate propagates", async () => {
  const { ctx, backend } = ctxWith();
  const obs = textJson(await run(observe, ctx, {}));
  backend.failInput = { code: "FOREGROUND_CHANGED", message: "changed" };
  assert.equal(await errOf(run(click, ctx, { screen_id: obs.screen_id, x: 100, y: 100 })), "FOREGROUND_CHANGED");
});

test("key_press: UNKNOWN_KEY and modifier-only chord rejected before any injection", async () => {
  const { ctx, backend } = ctxWith();
  const obs = textJson(await run(observe, ctx, {}));
  assert.equal(await errOf(run(keyPress, ctx, { screen_id: obs.screen_id, keys: "ctrl+wat" })), "UNKNOWN_KEY");
  assert.equal(await errOf(run(keyPress, ctx, { screen_id: obs.screen_id, keys: "ctrl" })), "INVALID_ARGUMENT");
  assert.equal(backend.inputCalls.length, 0);
  await run(keyPress, ctx, { screen_id: obs.screen_id, keys: "ctrl+shift+t" });
  const sentKeys: unknown = backend.inputCalls.at(-1);
  assert.ok(sentKeys && typeof sentKeys === "object" && "keys" in sentKeys);
  assert.deepEqual(sentKeys.keys, [{ vk: 0x11, ext: false }, { vk: 0x10, ext: false }, { vk: 0x54, ext: false }]);
});

test("type: control characters rejected (no shortcut emulation)", async () => {
  const { ctx } = ctxWith();
  const obs = textJson(await run(observe, ctx, {}));
  assert.equal(await errOf(run(typeTool, ctx, { screen_id: obs.screen_id, text: "a\x13b" })), "INVALID_ARGUMENT");
});

test("type: reports clipboard_restored transport flag (paste delivery)", async () => {
  const { ctx, backend } = ctxWith();
  const obs = textJson(await run(observe, ctx, {}));
  assert.equal(textJson(await run(typeTool, ctx, { screen_id: obs.screen_id, text: "hello" })).clipboard_restored, true);
  backend.inputExtra = { clipboard_restored: false };
  assert.equal(textJson(await run(typeTool, ctx, { screen_id: obs.screen_id, text: "hello" })).clipboard_restored, false);
  assert.equal(backend.inputCalls.length, 2); // flag is reported, never blocks delivery
});

test("wait_for_text: success and honest TIMEOUT", async () => {
  const { ctx, backend } = ctxWith();
  backend.perceiveResp = { matches: [{ text: "Build succeeded", source: "uia", bounds: { x: 1, y: 1, w: 2, h: 2 }, center: { x: 2, y: 2 } }] };
  const okR = await run(waitForText, ctx, { text: "Build succeeded", timeout_ms: 2000, poll_ms: 200 });
  assert.equal(textJson(okR).found, true);
  backend.perceiveResp = { matches: [] };
  assert.equal(await errOf(run(waitForText, ctx, { text: "nope", timeout_ms: 700, poll_ms: 250 })), "TIMEOUT");
});

test("wait_for_text absent+must_appear_first never seen -> TIMEOUT, not false success", async () => {
  const { ctx, backend } = ctxWith();
  backend.perceiveResp = { matches: [] };
  assert.equal(await errOf(run(waitForText, ctx, { text: "Generating...", absent: true, must_appear_first: true, timeout_ms: 700, poll_ms: 250 })), "TIMEOUT");
});

test("wait_for_change: detects thumbprint delta, times out when static", async () => {
  const { ctx, backend } = ctxWith();
  const ramp = (flip: boolean) => Buffer.from(Array.from({ length: 64 }, (_, i) => (flip ? 255 - (i * 4) % 256 : (i * 4) % 256))).toString("base64");
  backend.capThumb = ramp(false);
  const base = textJson(await run(observe, ctx, {}));
  backend.capThumb = ramp(true); // structurally different screen after baseline (uniform buffers would mean-center to zero)
  const r = await run(waitForChange, ctx, { screen_id: base.screen_id, timeout_ms: 3000, poll_ms: 200, threshold: 0.05 });
  assert.equal(textJson(r).changed, true);
  const { ctx: c2 } = ctxWith();
  assert.equal(await errOf(run(waitForChange, c2, { timeout_ms: 700, poll_ms: 250 })), "TIMEOUT");
});

test("window_focus: unauthorized window refused BEFORE focusing (§8 regression)", async () => {
  const savedPid = process.env.COMPUTER_CONTROL_ALLOWED_PIDS;
  const savedInput = process.env.COMPUTER_CONTROL_INPUT_ENABLED;
  process.env.COMPUTER_CONTROL_ALLOWED_PIDS = "9999"; // target pid 777 not listed
  process.env.COMPUTER_CONTROL_INPUT_ENABLED = "true";
  try {
    const policy = Policy.load();
    const backend = new FakeBackend();
    const ctx = createCtx({ backend, policy });
    assert.equal(await errOf(run(windowFocus, ctx, { hwnd: 42 })), "POLICY_DENIED");
    assert.equal(backend.focusCalls.length, 0); // never intentionally focused
  } finally {
    if (savedPid === undefined) delete process.env.COMPUTER_CONTROL_ALLOWED_PIDS;
    else process.env.COMPUTER_CONTROL_ALLOWED_PIDS = savedPid;
    if (savedInput === undefined) delete process.env.COMPUTER_CONTROL_INPUT_ENABLED;
    else process.env.COMPUTER_CONTROL_INPUT_ENABLED = savedInput;
  }
});

test("window_focus: unknown hwnd -> WINDOW_NOT_FOUND without focusing", async () => {
  const { ctx, backend } = ctxWith();
  assert.equal(await errOf(run(windowFocus, ctx, { hwnd: 123456789 })), "WINDOW_NOT_FOUND");
  assert.equal(backend.focusCalls.length, 0);
});

test("perception binding carries live UI state, not match data (§9 boundary)", async () => {
  const { ctx, backend } = ctxWith();
  backend.perceiveResp = { matches: [{ text: "Save", source: "uia", bounds: { x: 50, y: 60, w: 70, h: 20 }, center: { x: 85, y: 70 } }] };
  const r = await run(findText, ctx, { text: "Save" });
  const j = textJson(r);
  assert.ok(typeof j.screen_id === "string");
  const bound = ctx.store.require(j.screen_id as string);
  // Binding geometry/foreground come from CurrentUiState, not from the match rect.
  assert.deepEqual(bound.virtual_screen, { x: 0, y: 0, w: 1920, h: 1080 });
  assert.equal(bound.foreground?.hwnd, 42);
  // A bare match payload without UI state cannot mint a binding: require() rejects it.
  assert.throws(() => ctx.store.require("scr-0-ocr-only-0000"), /STALE_SCREEN/);
  // Direct binder also needs the full outcome type: state fields present.
  const outcome: PerceiveOutcome = {
    ...liveState(), mode: "text", matches: [], engines_used: ["uia"], ocr_available: false, truncated: false,
  };
  const o2 = bindPerceptionOutcome(ctx.store, outcome);
  assert.ok(o2.screen_id);
});
