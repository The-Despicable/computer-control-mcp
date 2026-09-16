import test from "node:test";
import assert from "node:assert/strict";
import { ctxWith, envelope } from "./support.js";
import { click, keyPress, type as typeTool } from "../../src/tools/input.js";
import { windowFocus } from "../../src/tools/observation.js";
import type { ToolDef } from "../../src/tools/index.js";
import { observe } from "../../src/tools/observation.js";

async function withObs(tool: ToolDef, ctx: ReturnType<typeof ctxWith>["ctx"], args: Record<string, unknown>) {
  const obs = await observe.handler(ctx, {});
  const sid = JSON.parse((obs.content.find(c => c.type === "text") as { text: string }).text).screen_id as string;
  return envelope(tool.handler(ctx, { ...args, screen_id: sid }) as Promise<{ structuredContent: Record<string, unknown> }>);
}

test("click success -> CONFIRMED with a mutation receipt", async () => {
  const { ctx } = ctxWith();
  const env = await withObs(click, ctx, { x: 100, y: 100 });
  assert.equal(env.ok, true);
  assert.equal(env.status, "CONFIRMED");
  assert.match(String(env.mutation_id), /^mut-/);
  assert.equal(env.operation, "click");
});

test("click without screen_id -> REJECTED (not uncertain)", async () => {
  const { ctx } = ctxWith();
  const env = await envelope(click.handler(ctx, { x: 5, y: 5 }) as Promise<{ structuredContent: Record<string, unknown> }>);
  assert.equal(env.ok, false);
  assert.equal(env.status, "REJECTED");
  assert.equal((env.error as { code: string }).code, "NO_OBSERVATION");
  assert.match(String(env.mutation_id), /^mut-/);
  assert.equal(env.reason, "NO_OBSERVATION");
});

test("click policy denied -> REJECTED", async () => {
  const { ctx } = ctxWith();
  const obs = await observe.handler(ctx, {});
  const sid = JSON.parse((obs.content.find(c => c.type === "text") as { text: string }).text).screen_id as string;
  ctx.policy.inputEnabled = false;
  const env = await envelope(click.handler(ctx, { screen_id: sid, x: 5, y: 5 }) as Promise<{ structuredContent: Record<string, unknown> }>);
  assert.equal(env.status, "REJECTED");
  assert.equal((env.error as { code: string }).code, "POLICY_DENIED");
});

test("backend failure AFTER dispatch -> UNCERTAIN, plus a receipt", async () => {
  const { ctx, backend } = ctxWith();
  backend.failInput = { code: "BACKEND_ERROR", message: "transport timeout after dispatch", dispatch: "post" };
  const env = await withObs(click, ctx, { x: 100, y: 100 });
  assert.equal(env.ok, false);
  assert.equal(env.status, "UNCERTAIN");
  assert.match(String(env.mutation_id), /^mut-/);
  assert.equal(env.reason, "BACKEND_ERROR");
});

test("backend failure BEFORE dispatch -> REJECTED", async () => {
  const { ctx, backend } = ctxWith();
  backend.failInput = { code: "FOREGROUND_CHANGED", message: "changed", dispatch: "pre" };
  const env = await withObs(click, ctx, { x: 100, y: 100 });
  assert.equal(env.status, "REJECTED");
  assert.equal((env.error as { code: string }).code, "FOREGROUND_CHANGED");
});

test("key_press unknown key -> REJECTED and nothing injected", async () => {
  const { ctx, backend } = ctxWith();
  const env = await withObs(keyPress, ctx, { keys: "ctrl+wat" });
  assert.equal(env.status, "REJECTED");
  assert.equal((env.error as { code: string }).code, "UNKNOWN_KEY");
  assert.equal(backend.inputCalls.length, 0);
});

test("type reports the transport actually used", async () => {
  const { ctx, backend } = ctxWith();
  backend.transport = "unicode";
  const env = await withObs(typeTool, ctx, { text: "hello" });
  assert.equal(env.ok, true);
  assert.equal(env.status, "CONFIRMED");
  assert.equal(env.transport, "unicode");
});

test("window_focus success -> CONFIRMED", async () => {
  const { ctx } = ctxWith();
  const env = await envelope(windowFocus.handler(ctx, { hwnd: 42 }) as Promise<{ structuredContent: Record<string, unknown> }>);
  assert.equal(env.ok, true);
  assert.equal(env.status, "CONFIRMED");
  assert.equal(env.operation, "window_focus");
});

test("window_focus unknown hwnd -> REJECTED", async () => {
  const { ctx, backend } = ctxWith();
  const env = await envelope(windowFocus.handler(ctx, { hwnd: 999 }) as Promise<{ structuredContent: Record<string, unknown> }>);
  assert.equal(env.status, "REJECTED");
  assert.equal((env.error as { code: string }).code, "WINDOW_NOT_FOUND");
  assert.equal(backend.focusCalls.length, 0);
});
