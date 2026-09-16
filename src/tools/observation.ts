import { z } from "zod";
import { okResult } from "../core/result.js";
import { fail } from "../core/errors.js";
import type { Ctx } from "../deps.js";
import { parseToolArgs } from "./args.js";
import type { ToolDef } from "./index.js";
import { beginMutation, noteBinding, mutationSuccess, mutationFailure } from "./mutation.js";

const ObserveArgs = z.object({
  target: z.union([
    z.literal("screen"),
    z.object({ monitor: z.number().int().min(0) }),
    z.object({ window: z.number().int() }),
    z.object({ x: z.number(), y: z.number(), w: z.number().int().positive(), h: z.number().int().positive() }),
  ]).default("screen"),
  format: z.enum(["png", "jpeg"]).default("png"),
  quality: z.number().int().min(30).max(95).default(80),
  max_dimension: z.number().int().min(0).default(1924),
  include_ui: z.boolean().default(false),
});

const WindowFocusArgs = z.object({
  hwnd: z.number().int(),
});

export const observe: ToolDef = {
  name: "observe",
  title: "Observe the screen",
  readOnly: true,
  description:
    "Capture the current screen state. Returns an actual MCP image (base64 PNG/JPEG, not a file path) plus " +
    "structured metadata: screen_id, timestamp, dimensions, scale, monitor geometry, and foreground window. " +
    "Use screen_id to bind subsequent mutations. Cheapest perception ladder: prefer find_text/find_element; " +
    "use observe when visual reasoning is genuinely required.",
  shape: ObserveArgs.shape,
  async handler(ctx: Ctx, raw: unknown) {
    const a = parseToolArgs(ObserveArgs, raw);
    const cap = await ctx.backend.capture({
      target: a.target, format: a.format, quality: a.quality,
      max_dimension: a.max_dimension || 0, thumbprint_only: false,
    });
    if (!cap.screenshot_b64) fail("BACKEND_ERROR", "capture produced no image");
    const bytes = Math.floor(((cap.screenshot_b64 as string).length) * 0.75);
    if (bytes > ctx.policy.maxImageBytes)
      fail("ACTION_FAILED", `screenshot too large (${(bytes / 1048576).toFixed(1)} MB > limit)`,
        { bytes, limit_bytes: ctx.policy.maxImageBytes },
        "pass max_dimension (e.g. 1280) or format:'jpeg' with quality ~70");
    let ui: unknown;
    if (a.include_ui) {
      try { ui = (await ctx.backend.perceive({ mode: "summary", scope: "foreground", limit: 120, engine: "uia" })).matches; }
      catch { ui = { error: "uia summary unavailable" }; }
    }
    const shot = cap.screenshot_b64 as string;
    const obs = ctx.store.addImage({ ...cap, screenshot_b64: shot }, ui);
    const meta = {
      screen_id: obs.screen_id, seq: obs.seq,
      timestamp: cap.timestamp, timestamp_iso: new Date(cap.timestamp).toISOString(),
      image: { width: cap.width, height: cap.height, format: cap.format, scale: cap.scale, origin: cap.origin },
      region: cap.region, monitors: cap.monitors, virtual_screen: cap.virtual_screen,
      foreground: cap.foreground, cursor: cap.cursor,
      max_observation_age_ms: ctx.policy.maxObservationAgeMs,
      note: "click/scroll with space:'image' use pixel coordinates in THIS image (origin top-left). " +
            "Mutations must pass this screen_id and must be sent before it expires.",
    };
    return okResult("observe", { ...meta }, { data: shot, mimeType: cap.format === "jpeg" ? "image/jpeg" : "image/png" });
  },
};

export const windowList: ToolDef = {
  name: "window_list",
  title: "List top-level windows",
  readOnly: true,
  description:
    "Enumerate visible top-level windows: HWND, owning process PID (the real owner PID via GetWindowThreadProcessId, " +
    "never the PowerShell host PID), process name, title, bounds, z-order, minimized/foreground flags. " +
    "Also returns a fresh screen_id binding for subsequent mutations.",
  shape: {},
  async handler(ctx: Ctx) {
    const r = await ctx.backend.windows();
    const obs = ctx.store.addBinding(r);
    return okResult("window_list", {
      screen_id: obs.screen_id, timestamp: r.timestamp, windows: r.windows,
      foreground: r.foreground, monitors: r.monitors, virtual_screen: r.virtual_screen,
    });
  },
};

export const windowFocus: ToolDef = {
  name: "window_focus",
  title: "Focus a window",
  description:
    "Bring a window to the foreground by HWND (restores it if minimized) and VERIFY the focus took effect. " +
    "The allowlist is checked BEFORE focusing: unauthorized windows are refused without ever being focused. " +
    "Returns a fresh screen_id bound to the newly focused window — use it for subsequent input. " +
    "This is a mutation: it is refused in observe-only mode.",
  shape: WindowFocusArgs.shape,
  async handler(ctx: Ctx, raw: unknown) {
    const a = parseToolArgs(WindowFocusArgs, raw);
    const receipt = beginMutation("window_focus");
    try {
      ctx.policy.assertInputEnabled();
      // §8 sequence: resolve current window/process -> policy check -> focus -> verify -> fresh screen_id.
      // An unauthorized window must never be intentionally focused to discover it was unauthorized.
      const listing = await ctx.backend.windows();
      const target = listing.windows.find(w => w.hwnd === a.hwnd);
      if (!target) fail("WINDOW_NOT_FOUND", `no visible top-level window with hwnd ${a.hwnd}`);
      ctx.policy.assertWindowAllowed({
        hwnd: target.hwnd, pid: target.pid, process: target.process,
        title: target.title, bounds: target.bounds,
      });
      const state = await ctx.backend.focus(a.hwnd);
      if (!state.foreground || state.foreground.hwnd !== a.hwnd)
        fail("ACTION_FAILED", `focus verification failed for hwnd ${a.hwnd}`, { foreground: state.foreground });
      ctx.policy.assertWindowAllowed(state.foreground);
      const obs = ctx.store.addBinding(state);
      noteBinding(receipt, obs);
      return mutationSuccess("window_focus", receipt, {
        focused: state.foreground,
        note: "subsequent click/type/key_press/scroll must use this new screen_id",
      });
    } catch (e) { mutationFailure(e, receipt); }
  },
};
