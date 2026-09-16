import { createCtx, type Backend, type Ctx, type CurrentUiState, type CaptureResult, type PerceiveOutcome, type WindowsResult, type InputResult } from "../../src/deps.js";
import { Policy } from "../../src/core/policy.js";
import { ToolError, toToolError } from "../../src/core/errors.js";
import { errorResult } from "../../src/core/result.js";

export function liveState(): CurrentUiState {
  return {
    monitors: [{ index: 0, x: 0, y: 0, w: 1920, h: 1080, scale: 1, primary: true, device: "d" }],
    virtual_screen: { x: 0, y: 0, w: 1920, h: 1080 },
    foreground: { hwnd: 42, pid: 777, process: "app", title: "App", bounds: { x: 10, y: 10, w: 800, h: 600 } },
    cursor: { x: 5, y: 5 }, timestamp: Date.now(),
  };
}

export class FakeBackend implements Backend {
  live: CurrentUiState = liveState();
  inputCalls: unknown[] = [];
  focusCalls: number[] = [];
  failInput: { code: ToolError["code"]; message: string; dispatch?: "pre" | "post" } | null = null;
  perceiveResp: { matches: PerceiveOutcome["matches"] } = { matches: [] };
  capThumb = Buffer.alloc(64, 128).toString("base64");
  inputExtra: { clipboard_restored?: boolean } = {};
  transport: "clipboard" | "unicode" = "clipboard";

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
  async focus(hwnd: number): Promise<CurrentUiState> { this.focusCalls.push(hwnd); return this.live; }
  async perceive(): Promise<PerceiveOutcome> {
    return { ...this.live, mode: "text", matches: this.perceiveResp.matches, engines_used: ["uia"], ocr_available: false, truncated: false };
  }
  async input(_req: unknown): Promise<InputResult> {
    this.inputCalls.push(_req);
    const failed = this.failInput;
    if (failed) {
      const e = new ToolError(failed.code, failed.message);
      e.dispatch = failed.dispatch ?? "pre";
      throw e;
    }
    return { state: this.live, ...this.inputExtra, transport: this.transport };
  }
}

export function ctxWith(inputEnabled = true): { ctx: Ctx; backend: FakeBackend } {
  const saved = process.env.COMPUTER_CONTROL_INPUT_ENABLED;
  process.env.COMPUTER_CONTROL_INPUT_ENABLED = inputEnabled ? "true" : "false";
  const policy = Policy.load();
  if (saved === undefined) delete process.env.COMPUTER_CONTROL_INPUT_ENABLED;
  else process.env.COMPUTER_CONTROL_INPUT_ENABLED = saved;
  const backend = new FakeBackend();
  return { ctx: createCtx({ backend, policy }), backend };
}

/** Run a tool the way server.ts does, returning the structured envelope (success or error). */
export async function envelope(p: Promise<{ structuredContent: Record<string, unknown> }>): Promise<Record<string, unknown>> {
  try {
    const r = await p;
    return r.structuredContent;
  } catch (e) {
    return errorResult(toToolError(e)).structuredContent as Record<string, unknown>;
  }
}

export async function errCode(p: Promise<unknown>): Promise<string | null> {
  try { await p; return null; } catch (e: unknown) { return toToolError(e).code; }
}
