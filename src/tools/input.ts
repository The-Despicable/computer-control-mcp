import { z } from "zod";
import { okResult } from "../core/result.js";
import { fail } from "../core/errors.js";
import { resolvePoint } from "../core/geometry.js";
import { monitorsHash } from "../core/util.js";
import { assertTypableText, parseChord } from "../core/keys.js";
import type { Observation } from "../core/store.js";
import type { Ctx } from "../deps.js";
import { parseToolArgs } from "./args.js";
import type { ToolDef } from "./index.js";
import { beginMutation, noteBinding, mutationSuccess, mutationFailure } from "./mutation.js";

/**
 * Every mutation goes through this gate chain:
 *   1. screen_id present + fresh            -> NO_OBSERVATION / STALE_SCREEN
 *   2. input enabled + window allowlist     -> POLICY_DENIED
 *   3. coordinate / key validation          -> INVALID_COORDINATE / UNKNOWN_KEY / INVALID_ARGUMENT
 *   4. in-process pre-injection re-check    -> FOREGROUND_CHANGED / STALE_SCREEN (geometry)
 * The foreground HWND is re-verified inside the helper IMMEDIATELY before SendInput,
 * so a focus change between validation and injection cannot redirect input.
 *
 * screen_id is optional in the MCP schema ON PURPOSE: a missing binding must
 * surface as structured NO_OBSERVATION from the handler, not as an MCP-protocol
 * validation error. The description marks it required for callers.
 */
export function bindMutation(ctx: Ctx, screenId: string | undefined): Observation {
  const obs = ctx.store.require(screenId);
  ctx.policy.assertInputEnabled();
  ctx.policy.assertWindowAllowed(obs.foreground);
  if (!obs.foreground) fail("ACTION_FAILED", "observation has no foreground window; cannot safely bind input");
  return obs;
}

export function expectation(obs: Observation) {
  const fg = obs.foreground;
  if (!fg) fail("ACTION_FAILED", "observation has no foreground window; cannot safely bind input");
  return {
    foreground_hwnd: (fg as { hwnd: number }).hwnd,
    virtual_screen: obs.virtual_screen,
    monitors_hash: monitorsHash(obs.monitors),
  };
}

const SPACE = z.enum(["image", "desktop", "monitor"]);

const ClickArgs = z.object({
  screen_id: z.string().min(1).optional().describe("REQUIRED: screen_id from a recent observation"),
  x: z.number(),
  y: z.number(),
  space: SPACE.default("image"),
  monitor: z.number().int().min(0).optional(),
  button: z.enum(["left", "right", "middle"]).default("left"),
  count: z.union([z.literal(1), z.literal(2)]).default(1),
});

const TypeArgs = z.object({
  screen_id: z.string().min(1).optional().describe("REQUIRED: screen_id from a recent observation"),
  text: z.string().min(1).max(4000),
});

const KeyPressArgs = z.object({
  screen_id: z.string().min(1).optional().describe("REQUIRED: screen_id from a recent observation"),
  keys: z.string().min(1).max(120),
});

const ScrollArgs = z.object({
  screen_id: z.string().min(1).optional().describe("REQUIRED: screen_id from a recent observation"),
  direction: z.enum(["up", "down"]),
  amount: z.number().int().min(1).max(50).default(3),
  x: z.number().optional(),
  y: z.number().optional(),
  space: SPACE.optional(),
  monitor: z.number().int().min(0).optional(),
});

const PointArgs = z.object({
  x: z.number(),
  y: z.number(),
  space: SPACE.default("image"),
  monitor: z.number().int().min(0).optional(),
});

const DragArgs = z.object({
  screen_id: z.string().min(1).optional().describe("REQUIRED: screen_id from a recent observation"),
  from: PointArgs,
  to: PointArgs,
  button: z.enum(["left", "right", "middle"]).default("left"),
  duration_ms: z.number().int().min(0).max(5000).default(300),
});

export const click: ToolDef = {
  name: "click",
  title: "Mouse click",
  description:
    "Click at a validated position. Requires a fresh screen_id; the foreground window and display geometry are " +
    "re-verified immediately before injection — stale observations or focus changes are rejected with " +
    "STALE_SCREEN / FOREGROUND_CHANGED instead of sending input to the wrong target. Returns a mutation " +
    "receipt with status CONFIRMED / REJECTED / UNCERTAIN.",
  shape: ClickArgs.shape,
  async handler(ctx: Ctx, raw: unknown) {
    const a = parseToolArgs(ClickArgs, raw);
    const receipt = beginMutation("click", a.screen_id);
    try {
      const obs = bindMutation(ctx, a.screen_id);
      noteBinding(receipt, obs);
      if (a.space === "monitor" && a.monitor === undefined)
        fail("INVALID_ARGUMENT", "space='monitor' requires the 'monitor' index");
      const pt = resolvePoint({ space: a.space, x: a.x, y: a.y, monitor: a.monitor }, obs);
      const r = await ctx.backend.input({ action: "click", x: pt.x, y: pt.y, button: a.button, count: a.count, expect: expectation(obs) });
      const post = ctx.store.addBinding(r.state);
      return mutationSuccess("click", receipt, { at: pt, button: a.button, count: a.count, screen_id: post.screen_id });
    } catch (e) { mutationFailure(e, receipt); }
  },
};

export const type: ToolDef = {
  name: "type",
  title: "Type text",
  description:
    "Type literal text into the current foreground control. Preferred transport is clipboard paste " +
    "(atomic delivery; prior clipboard saved and restored, reported as clipboard_restored); if the clipboard " +
    "is unavailable the backend falls back to direct Unicode input and reports transport='unicode'. " +
    "Control characters are rejected — this tool can NEVER express keyboard shortcuts; use key_press for " +
    "keys/chords. Newlines (\\n) and tabs (\\t) are honored. Returns a mutation receipt.",
  shape: TypeArgs.shape,
  async handler(ctx: Ctx, raw: unknown) {
    const a = parseToolArgs(TypeArgs, raw);
    const receipt = beginMutation("type", a.screen_id);
    try {
      const obs = bindMutation(ctx, a.screen_id);
      noteBinding(receipt, obs);
      assertTypableText(a.text);
      const r = await ctx.backend.input({ action: "type", text: a.text, expect: expectation(obs) });
      const post = ctx.store.addBinding(r.state);
      return mutationSuccess("type", receipt, {
        typed_chars: a.text.length,
        clipboard_restored: r.clipboard_restored ?? true,
        transport: r.transport ?? "clipboard",
        screen_id: post.screen_id,
      });
    } catch (e) { mutationFailure(e, receipt); }
  },
};

export const keyPress: ToolDef = {
  name: "key_press",
  title: "Press key or chord",
  description:
    "Press a single key or chord, e.g. 'enter', 'ctrl+s', 'ctrl+shift+p'. The whole chord is validated " +
    "server-side before anything is injected; unknown key names fail with UNKNOWN_KEY and send nothing. " +
    "Returns a mutation receipt.",
  shape: KeyPressArgs.shape,
  async handler(ctx: Ctx, raw: unknown) {
    const a = parseToolArgs(KeyPressArgs, raw);
    const receipt = beginMutation("key_press", a.screen_id);
    try {
      const obs = bindMutation(ctx, a.screen_id);
      noteBinding(receipt, obs);
      const chord = parseChord(a.keys); // UNKNOWN_KEY / INVALID_ARGUMENT — before injection
      const r = await ctx.backend.input({
        action: "keys",
        keys: chord.map(k => ({ vk: k.vk, ext: k.ext })),
        expect: expectation(obs),
      });
      const post = ctx.store.addBinding(r.state);
      return mutationSuccess("key_press", receipt, { keys: a.keys, sent: chord.map(k => k.vk), screen_id: post.screen_id });
    } catch (e) { mutationFailure(e, receipt); }
  },
};

export const scroll: ToolDef = {
  name: "scroll",
  title: "Mouse wheel scroll",
  description:
    "Scroll the mouse wheel at the current cursor position, or at a validated position. Amount is bounded " +
    "(1..50 wheel notches per call). Returns a mutation receipt.",
  shape: ScrollArgs.shape,
  async handler(ctx: Ctx, raw: unknown) {
    const a = parseToolArgs(ScrollArgs, raw);
    const receipt = beginMutation("scroll", a.screen_id);
    try {
      const obs = bindMutation(ctx, a.screen_id);
      noteBinding(receipt, obs);
      let pt: { x: number; y: number } | undefined;
      if (a.x !== undefined && a.y !== undefined) {
        if (a.space === "monitor" && a.monitor === undefined)
          fail("INVALID_ARGUMENT", "space='monitor' requires the 'monitor' index");
        pt = resolvePoint({ space: a.space ?? "image", x: a.x, y: a.y, monitor: a.monitor }, obs);
      } else if (a.x !== undefined || a.y !== undefined || a.space === "monitor") {
        fail("INVALID_ARGUMENT", "provide both x and y (or neither to scroll at the current cursor position)");
      }
      const r = await ctx.backend.input({
        action: "scroll", direction: a.direction, amount: a.amount,
        ...(pt ? { x: pt.x, y: pt.y } : {}),
        expect: expectation(obs),
      });
      const post = ctx.store.addBinding(r.state);
      return mutationSuccess("scroll", receipt, { direction: a.direction, amount: a.amount, at: pt ?? "cursor", screen_id: post.screen_id });
    } catch (e) { mutationFailure(e, receipt); }
  },
};

export const drag: ToolDef = {
  name: "drag",
  title: "Mouse drag",
  description:
    "Press the mouse at a validated source point, move to a validated destination, and release. Both points " +
    "are resolved and validated against the bound observation (never clamped; off-monitor/dead-space rejected) " +
    "and the foreground HWND + display geometry are re-verified immediately before injection. A basic validated " +
    "primitive — not path scripting. Returns a mutation receipt.",
  shape: DragArgs.shape,
  async handler(ctx: Ctx, raw: unknown) {
    const a = parseToolArgs(DragArgs, raw);
    const receipt = beginMutation("drag", a.screen_id);
    try {
      const obs = bindMutation(ctx, a.screen_id);
      noteBinding(receipt, obs);
      const from = resolvePoint({ space: a.from.space, x: a.from.x, y: a.from.y, monitor: a.from.monitor }, obs);
      const to = resolvePoint({ space: a.to.space, x: a.to.x, y: a.to.y, monitor: a.to.monitor }, obs);
      const r = await ctx.backend.input({
        action: "drag", from, to, button: a.button, duration_ms: a.duration_ms,
        expect: expectation(obs),
      });
      const post = ctx.store.addBinding(r.state);
      return mutationSuccess("drag", receipt, { from, to, button: a.button, duration_ms: a.duration_ms, screen_id: post.screen_id });
    } catch (e) { mutationFailure(e, receipt); }
  },
};
