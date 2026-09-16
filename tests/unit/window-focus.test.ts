import test from "node:test";
import assert from "node:assert/strict";
import { ctxWith, envelope } from "./support.js";
import { windowFocus } from "../../src/tools/observation.js";

async function run(ctx: ReturnType<typeof ctxWith>["ctx"], args: Record<string, unknown>) {
  return envelope(windowFocus.handler(ctx, args) as Promise<{ structuredContent: Record<string, unknown> }>);
}

test("window_focus uses a single-window lookup, not a full window enumeration", async () => {
  const { ctx, backend } = ctxWith();
  let windowsCalls = 0;
  const orig = backend.windows.bind(backend);
  backend.windows = async () => { windowsCalls += 1; return orig(); };
  const env = await run(ctx, { hwnd: 42 });
  assert.equal(env.ok, true);
  assert.equal(env.status, "CONFIRMED");
  assert.equal(windowsCalls, 0, "window_focus must not call windows()");
});

test("window_focus on an unknown hwnd -> REJECTED WINDOW_NOT_FOUND, nothing focused", async () => {
  const { ctx, backend } = ctxWith();
  const env = await run(ctx, { hwnd: 999 });
  assert.equal(env.status, "REJECTED");
  assert.equal((env.error as { code: string }).code, "WINDOW_NOT_FOUND");
  assert.equal(backend.focusCalls.length, 0);
});
