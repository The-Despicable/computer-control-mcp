import { z } from "zod";
import { okResult } from "../core/result.js";
import { fail } from "../core/errors.js";
import { slicePage } from "../core/text.js";
import { evaluateReadProvenance, type BoundTarget } from "../core/target-binding.js";
import type { Ctx } from "../deps.js";
import { parseToolArgs } from "./args.js";
import type { ToolDef } from "./index.js";

const MAX_FETCH = 200000;

const ReadTextArgs = z.object({
  screen_id: z.string().min(1).optional().describe("Optional: bind to a fresh observation's foreground window (target identity check)"),
  offset: z.number().int().min(0).max(MAX_FETCH).default(0),
  limit: z.number().int().min(1).max(8000).default(4000),
});

/**
 * Generic, bounded read of the foreground window's structured text.
 * UIA TextPattern first, ValuePattern fallback; never OCR; never scrolls.
 * This is a capability, not a reader agent: the caller pages with offset/limit
 * and decides what the content means.
 */
export const readText: ToolDef = {
  name: "read_text",
  title: "Read window text",
  readOnly: true,
  description:
    "Read the foreground window's text through UI Automation (TextPattern first, then ValuePattern) WITHOUT scrolling " +
    "or taking a screenshot. Returns a bounded page: pass offset/limit to walk large content. Structured UIA text only " +
    "— no OCR. If screen_id is supplied the read is pinned to that observation's foreground window and rejected with " +
    "FOREGROUND_CHANGED if it moved. Returns the target window that was read and whether more text remains.",
  shape: ReadTextArgs.shape,
  async handler(ctx: Ctx, raw: unknown) {
    const a = parseToolArgs(ReadTextArgs, raw);
    if (a.offset + a.limit > MAX_FETCH)
      fail("INVALID_ARGUMENT", `offset + limit must be <= ${MAX_FETCH}`, { offset: a.offset, limit: a.limit });
    let bound: BoundTarget | null = null;
    if (a.screen_id) {
      const obs = ctx.store.require(a.screen_id);
      if (!obs.foreground) fail("ACTION_FAILED", "observation has no foreground window; cannot bind a text read");
      // Identity is HWND + owner PID; title is not part of identity.
      bound = { hwnd: obs.foreground.hwnd, pid: obs.foreground.pid };
    }
    const r = await ctx.backend.readText({
      expected_hwnd: bound?.hwnd,
      expected_pid: bound?.pid,
      max_chars: Math.min(a.offset + a.limit, MAX_FETCH),
    });
    if (!r.identity) fail("BACKEND_ERROR", "read produced no target identity evidence");
    // Provenance: the text is only returned if it provably came from the bound
    // target and that target did not change/die during the read.
    const verdict = evaluateReadProvenance(bound, r.identity);
    if (!verdict.ok) fail(verdict.code, verdict.reason, { target: r.target ?? null });
    const page = slicePage(r.text ?? "", a.offset, a.limit, r.complete !== false);
    return okResult("read_text", {
      ...page,
      source: r.source,
      control_type: r.control_type ?? null,
      target: r.target ?? null,
      note: page.truncated
        ? "more text may exist; call read_text again with offset = offset + returned_chars"
        : "end of available text",
    });
  },
};
