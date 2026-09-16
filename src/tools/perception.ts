import { z } from "zod";
import { okResult } from "../core/result.js";
import { fail } from "../core/errors.js";
import { assertSafeRegex, MAX_REGEX_LENGTH } from "../core/regex.js";
import { bindPerceptionOutcome, type Ctx } from "../deps.js";
import { parseToolArgs } from "./args.js";
import type { ToolDef } from "./index.js";

const FindTextArgs = z.object({
  text: z.string().min(1).optional(),
  regex: z.string().max(MAX_REGEX_LENGTH).optional(),
  scope: z.enum(["foreground", "desktop"]).default("foreground"),
  engine: z.enum(["auto", "uia", "ocr"]).default("auto"),
  limit: z.number().int().min(1).max(50).default(10),
});

const FindElementArgs = z.object({
  name: z.string().min(1).optional(),
  control_type: z.string().min(2).optional(),
  automation_id: z.string().optional(),
  class_name: z.string().optional(),
  scope: z.enum(["foreground", "desktop"]).default("foreground"),
  limit: z.number().int().min(1).max(50).default(10),
});

export const findText: ToolDef = {
  name: "find_text",
  title: "Find on-screen text",
  readOnly: true,
  description:
    "Locate text on screen WITHOUT a screenshot. Searches the foreground window (or whole desktop) via UI " +
    "Automation first, then Windows OCR as fallback. Returns matches with desktop-absolute bounds + center " +
    "coordinates you can pass directly to click(space:'desktop'). An empty result is a valid observation " +
    "(ok:true, matches:[]). Also returns a fresh screen_id.",
  shape: FindTextArgs.shape,
  async handler(ctx: Ctx, raw: unknown) {
    const a = parseToolArgs(FindTextArgs, raw);
    if (!!a.text === !!a.regex) fail("INVALID_ARGUMENT", "pass exactly one of 'text' (substring) or 'regex'");
    if (a.regex) assertSafeRegex(a.regex);
    const r = await ctx.backend.perceive({
      mode: "text", text: a.text, regex: a.regex, scope: a.scope, engine: a.engine, limit: a.limit,
    });
    const obs = bindPerceptionOutcome(ctx.store, r);
    return okResult("find_text", {
      screen_id: obs.screen_id, matches: r.matches, engines_used: r.engines_used,
      ocr_available: r.ocr_available, truncated: r.truncated,
      note: "match bounds/center are desktop-absolute; click with space:'desktop' and these coordinates",
    });
  },
};

export const findElement: ToolDef = {
  name: "find_element",
  title: "Find a UI element",
  readOnly: true,
  description:
    "Find a UI element by accessible name (substring), control type (button/edit/menuitem/...), automation id, " +
    "or class name via UI Automation. Returns bounds + center (desktop-absolute) plus element metadata and a " +
    "fresh screen_id. Prefer this over screenshots when a semantic target exists.",
  shape: FindElementArgs.shape,
  async handler(ctx: Ctx, raw: unknown) {
    const a = parseToolArgs(FindElementArgs, raw);
    if (!a.name && !a.control_type && !a.automation_id && !a.class_name)
      fail("INVALID_ARGUMENT", "provide at least one of name/control_type/automation_id/class_name");
    const r = await ctx.backend.perceive({
      mode: "element", name: a.name, control_type: a.control_type,
      automation_id: a.automation_id, class_name: a.class_name, scope: a.scope, limit: a.limit,
    });
    const obs = bindPerceptionOutcome(ctx.store, r);
    return okResult("find_element", {
      screen_id: obs.screen_id, matches: r.matches, truncated: r.truncated,
      note: "match bounds/center are desktop-absolute; click with space:'desktop' and these coordinates",
    });
  },
};
