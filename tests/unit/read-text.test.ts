import test from "node:test";
import assert from "node:assert/strict";
import { slicePage } from "../../src/core/text.js";
import { readText } from "../../src/tools/read.js";
import { observe } from "../../src/tools/observation.js";
import { ctxWith, envelope } from "./support.js";

// ---- slicePage (deterministic paging semantics) ----

test("slicePage: empty document", () => {
  assert.deepEqual(slicePage("", 0, 40, true), { text: "", offset: 0, limit: 40, returned_chars: 0, total_known: 0, truncated: false });
});

test("slicePage: offset 0, bounded limit, more remains", () => {
  const p = slicePage("abcdef", 0, 3, true);
  assert.equal(p.text, "abc");
  assert.equal(p.total_known, 6);
  assert.equal(p.truncated, true);
});

test("slicePage: mid-document offset", () => {
  const p = slicePage("abcdef", 3, 3, true);
  assert.equal(p.text, "def");
  assert.equal(p.truncated, false);
});

test("slicePage: offset at/beyond end returns empty and is not truncated when complete", () => {
  assert.deepEqual(slicePage("abcdef", 6, 3, true), { text: "", offset: 6, limit: 3, returned_chars: 0, total_known: 6, truncated: false });
  assert.deepEqual(slicePage("abcdef", 99, 3, true), { text: "", offset: 99, limit: 3, returned_chars: 0, total_known: 6, truncated: false });
});

test("slicePage: Unicode is sliced by code unit consistently", () => {
  const full = "héllo wörld";
  assert.equal(slicePage(full, 0, 5, true).text, "héllo");
  assert.equal(slicePage(full, 6, 5, true).text, "wörld");
});

test("slicePage: incomplete fetch cannot claim end-of-document", () => {
  const p = slicePage("abcdef", 0, 10, false);
  assert.equal(p.text, "abcdef");
  assert.equal(p.total_known, null);
  assert.equal(p.truncated, true);
});

test("slicePage: mid offset on an incomplete fetch", () => {
  const p = slicePage("abcdefghij", 5, 10, false);
  assert.equal(p.text, "fghij");
  assert.equal(p.total_known, null);
  assert.equal(p.truncated, true);
});

// ---- read_text tool ----

async function sidOf(ctx: ReturnType<typeof ctxWith>["ctx"]): Promise<string> {
  const obs = await observe.handler(ctx, {});
  return JSON.parse((obs.content.find(c => c.type === "text") as { text: string }).text).screen_id as string;
}
async function run(ctx: ReturnType<typeof ctxWith>["ctx"], args: Record<string, unknown>) {
  return envelope(readText.handler(ctx, args) as Promise<{ structuredContent: Record<string, unknown> }>);
}

test("read_text default returns the whole short document, not truncated", async () => {
  const { ctx } = ctxWith();
  const env = await run(ctx, {});
  assert.equal(env.ok, true);
  assert.equal(env.text, "the quick brown fox jumps over the lazy dog");
  assert.equal(env.truncated, false);
  assert.equal(env.total_known, 43);
  assert.equal(env.source, "text");
});

test("read_text pages with offset/limit", async () => {
  const { ctx } = ctxWith();
  const env = await run(ctx, { offset: 4, limit: 5 });
  assert.equal(env.text, "quick");
  assert.equal(env.returned_chars, 5);
  assert.equal(env.truncated, true);
});

test("read_text honours a screen_id binding (target identity)", async () => {
  const { ctx } = ctxWith();
  const sid = await sidOf(ctx);
  const env = await run(ctx, { screen_id: sid, offset: 0, limit: 10 });
  assert.equal(env.ok, true);
  assert.equal(env.text, "the quick ");
});

test("read_text rejects when the bound foreground moved", async () => {
  const { ctx, backend } = ctxWith();
  const sid = await sidOf(ctx);
  backend.live = { ...backend.live, foreground: backend.live.foreground ? { ...backend.live.foreground, hwnd: 99 } : null };
  const env = await run(ctx, { screen_id: sid });
  assert.equal(env.ok, false);
  assert.equal((env.error as { code: string }).code, "FOREGROUND_CHANGED");
});

test("read_text rejects offset+limit beyond the fetch cap", async () => {
  const { ctx } = ctxWith();
  const env = await run(ctx, { offset: 199000, limit: 8000 });
  assert.equal(env.ok, false);
  assert.equal((env.error as { code: string }).code, "INVALID_ARGUMENT");
});

test("read_text offset beyond the end returns an empty page", async () => {
  const { ctx } = ctxWith();
  const env = await run(ctx, { offset: 5000, limit: 100 });
  assert.equal(env.ok, true);
  assert.equal(env.text, "");
  assert.equal(env.truncated, false);
});

// ---- target provenance (the central safety property) ----

test("read_text rejects a target whose owner PID changed during the read", async () => {
  const { ctx, backend } = ctxWith();
  backend.readTextIdentity = { start_pid: 777, end_pid: 999, window_valid: true };
  const env = await run(ctx, {});
  assert.equal(env.ok, false);
  assert.equal((env.error as { code: string }).code, "STALE_SCREEN");
});

test("read_text rejects a target destroyed during the read (no silent empty success)", async () => {
  const { ctx, backend } = ctxWith();
  backend.readTextIdentity = { start_pid: 777, end_pid: 0, window_valid: false };
  const env = await run(ctx, {});
  assert.equal(env.ok, false);
  assert.equal((env.error as { code: string }).code, "STALE_SCREEN");
});

test("read_text rejects HWND reuse by another process (bound pid mismatch)", async () => {
  const { ctx, backend } = ctxWith();
  const sid = await sidOf(ctx); // bound pid = 777
  backend.readTextIdentity = { start_pid: 888, end_pid: 888, window_valid: true }; // same hwnd, new owner
  const env = await run(ctx, { screen_id: sid });
  assert.equal(env.ok, false);
  assert.equal((env.error as { code: string }).code, "STALE_SCREEN");
});

test("read_text does not leak the new target's text when the binding is invalidated", async () => {
  const { ctx, backend } = ctxWith();
  const sid = await sidOf(ctx);
  backend.readTextValue = "SECRET-FROM-OTHER-WINDOW";
  backend.readTextIdentity = { start_pid: 777, end_pid: 999, window_valid: true };
  const env = await run(ctx, { screen_id: sid });
  assert.equal(env.ok, false);
  assert.equal("text" in env, false); // text is never surfaced on invalidation
});

test("read_text: a title-only change does not invalidate a read", async () => {
  const { ctx, backend } = ctxWith();
  const sid = await sidOf(ctx);
  backend.live = { ...backend.live, foreground: backend.live.foreground ? { ...backend.live.foreground, title: "renamed" } : null };
  const env = await run(ctx, { screen_id: sid });
  assert.equal(env.ok, true);
});
