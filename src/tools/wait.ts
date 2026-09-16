import { z } from "zod";
import { okResult } from "../core/result.js";
import { fail } from "../core/errors.js";
import { assertSafeRegex, MAX_REGEX_LENGTH } from "../core/regex.js";
import { rectsEqual } from "../core/geometry.js";
import { sleep, thumbprintDistance } from "../core/util.js";
import { bindPerceptionOutcome, type Ctx } from "../deps.js";
import { parseToolArgs } from "./args.js";
import type { ToolDef } from "./index.js";

const WaitArgs = z.object({
  duration_ms: z.number().int().min(0).max(30000),
});

const WaitForTextArgs = z.object({
  text: z.string().min(1).optional(),
  regex: z.string().max(MAX_REGEX_LENGTH).optional(),
  scope: z.enum(["foreground", "desktop"]).default("foreground"),
  engine: z.enum(["auto", "uia", "ocr"]).default("auto"),
  timeout_ms: z.number().int().min(250).max(60000).default(10000),
  poll_ms: z.number().int().min(200).max(2000).default(500),
  absent: z.boolean().default(false),
  must_appear_first: z.boolean().default(false),
});

const WaitForChangeArgs = z.object({
  screen_id: z.string().optional(),
  timeout_ms: z.number().int().min(250).max(60000).default(10000),
  poll_ms: z.number().int().min(200).max(2000).default(500),
  threshold: z.number().min(0.01).max(0.9).default(0.1),
  settle_ms: z.number().int().min(0).max(5000).default(0),
});

export const wait: ToolDef = {
  name: "wait", title: "Wait (bounded sleep)", readOnly: true,
  description: "Sleep for a bounded duration (max 30s). Prefer wait_for_text / wait_for_change to wait for STATE.",
  shape: WaitArgs.shape,
  async handler(_ctx: Ctx, raw: unknown) {
    const a = parseToolArgs(WaitArgs, raw);
    await sleep(a.duration_ms);
    return okResult("wait", { waited_ms: a.duration_ms });
  },
};

export const waitForText: ToolDef = {
  name: "wait_for_text", title: "Wait until text appears/disappears", readOnly: true,
  description:
    "Poll find_text (UIA, then OCR) until the text appears (or disappears with absent:true). Success only when " +
    "the text state is actually observed; otherwise TIMEOUT — never a false success. With absent:true and " +
    "must_appear_first:true, success requires having SEEN the text first (guards against never-rendered text).",
  shape: WaitForTextArgs.shape,
  async handler(ctx: Ctx, raw: unknown) {
    const a = parseToolArgs(WaitForTextArgs, raw);
    if (!!a.text === !!a.regex) fail("INVALID_ARGUMENT", "pass exactly one of 'text' or 'regex'");
    if (a.regex) assertSafeRegex(a.regex);
    const deadline = Date.now() + a.timeout_ms;
    let everSeen = false;
    let lastMatches: Array<{ text: string }> = [];
    for (;;) {
      const r = await ctx.backend.perceive({
        mode: "text", text: a.text, regex: a.regex, scope: a.scope, engine: a.engine, limit: 5,
      });
      lastMatches = r.matches;
      const found = r.matches.length > 0;
      if (found) everSeen = true;
      if (!a.absent && found) {
        const obs = bindPerceptionOutcome(ctx.store, r);
        return okResult("wait_for_text", { found: true, waited_ms: a.timeout_ms - (deadline - Date.now()), matches: r.matches, screen_id: obs.screen_id });
      }
      if (a.absent && !found && (!a.must_appear_first || everSeen)) {
        const obs = bindPerceptionOutcome(ctx.store, r);
        return okResult("wait_for_text", { absent: true, ever_seen: everSeen, matches: [], screen_id: obs.screen_id });
      }
      if (Date.now() + a.poll_ms >= deadline)
        fail("TIMEOUT",
          a.absent
            ? (a.must_appear_first && !everSeen ? "text never appeared before the deadline" : "text is still present after the deadline")
            : "text not found before the deadline",
          { timeout_ms: a.timeout_ms, ever_seen: everSeen, matches: lastMatches.slice(0, 3) },
          "extend timeout_ms, change scope/engine, or re-observe to inspect current state");
      await sleep(a.poll_ms);
    }
  },
};

export const waitForChange: ToolDef = {
  name: "wait_for_change", title: "Wait until the screen changes", readOnly: true,
  description:
    "Poll lightweight 8x8 perceptual thumbprints until the screen meaningfully changes (distance above " +
    "threshold, or foreground window / display geometry change). A timeout stays a timeout even if pixels are " +
    "changing below threshold. Optionally wait settle_ms for the screen to stabilize after the change.",
  shape: WaitForChangeArgs.shape,
  async handler(ctx: Ctx, raw: unknown) {
    const a = parseToolArgs(WaitForChangeArgs, raw);
    let base = a.screen_id ? ctx.store.require(a.screen_id) : null;
    if (a.screen_id && !base?.thumbprint)
      fail("INVALID_ARGUMENT", "baseline screen_id has no captured image; call observe() first or omit screen_id");
    if (!base) {
      const cap = await ctx.backend.capture({ target: "screen", thumbprint_only: true });
      const baselineThumb = Buffer.from(cap.thumbprint_b64, "base64");
      base = ctx.store.addBinding(cap, { thumbprint: baselineThumb });
    }
    const baseline = base;
    const baselineThumb = baseline.thumbprint;
    if (!baselineThumb) fail("INVALID_ARGUMENT", "baseline observation has no thumbprint; call observe() first or omit screen_id");
    const thumb0 = baselineThumb as Buffer;
    const deadline = Date.now() + a.timeout_ms;
    let lastDist = 0;
    for (;;) {
      const cap = await ctx.backend.capture({ target: baseline.region, thumbprint_only: true });
      lastDist = thumbprintDistance(thumb0, Buffer.from(cap.thumbprint_b64, "base64"));
      const fgChanged = (cap.foreground?.hwnd ?? 0) !== (baseline.foreground?.hwnd ?? 0);
      const geoChanged = !rectsEqual(cap.virtual_screen, baseline.virtual_screen);
      if (lastDist > a.threshold || fgChanged || geoChanged) {
        let settled = true;
        if (a.settle_ms > 0) {
          settled = false;
          const settleDeadline = Date.now() + a.settle_ms;
          let prev = Buffer.from(cap.thumbprint_b64, "base64");
          const step = Math.min(250, a.poll_ms);
          while (Date.now() < settleDeadline) {
            await sleep(step);
            const c2 = await ctx.backend.capture({ target: baseline.region, thumbprint_only: true });
            const cur = Buffer.from(c2.thumbprint_b64, "base64");
            if (thumbprintDistance(prev, cur) <= a.threshold) { settled = true; break; }
            prev = cur;
          }
        }
        const obs = ctx.store.addBinding(cap, { thumbprint: Buffer.from(cap.thumbprint_b64, "base64") });
        return okResult("wait_for_change", {
          changed: true, after_ms: a.timeout_ms - Math.max(0, deadline - Date.now()),
          thumbprint_distance: Math.round(lastDist * 1000) / 1000,
          foreground_changed: fgChanged, geometry_changed: geoChanged, settled, screen_id: obs.screen_id,
        });
      }
      if (Date.now() + a.poll_ms >= deadline)
        fail("TIMEOUT", "screen did not meaningfully change before the deadline",
          { timeout_ms: a.timeout_ms, last_thumbprint_distance: Math.round(lastDist * 1000) / 1000, threshold: a.threshold },
          "increase timeout_ms/threshold, or re-observe to inspect state manually");
      await sleep(a.poll_ms);
    }
  },
};
