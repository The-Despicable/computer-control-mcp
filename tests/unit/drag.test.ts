import test from "node:test";
import assert from "node:assert/strict";
import { ctxWith, envelope } from "./support.js";
import { drag } from "../../src/tools/input.js";
import { observe } from "../../src/tools/observation.js";
import type { ToolDef } from "../../src/tools/index.js";

async function sidOf(ctx: ReturnType<typeof ctxWith>["ctx"]): Promise<string> {
  const obs = await observe.handler(ctx, {});
  return JSON.parse((obs.content.find(c => c.type === "text") as { text: string }).text).screen_id as string;
}

async function run(ctx: ReturnType<typeof ctxWith>["ctx"], args: Record<string, unknown>) {
  return envelope(drag.handler(ctx, args) as Promise<{ structuredContent: Record<string, unknown> }>);
}

test("drag requires a fresh observation", async () => {
  const { ctx, backend } = ctxWith();
  const env = await run(ctx, { from: { x: 1, y: 1, space: "desktop" }, to: { x: 2, y: 2, space: "desktop" } });
  assert.equal(env.status, "REJECTED");
  assert.equal((env.error as { code: string }).code, "NO_OBSERVATION");
  assert.equal(backend.inputCalls.length, 0);
});

test("drag rejects an off-monitor source", async () => {
  const { ctx, backend } = ctxWith();
  const sid = await sidOf(ctx);
  const env = await run(ctx, { screen_id: sid, from: { x: 99999, y: 0, space: "desktop" }, to: { x: 2, y: 2, space: "desktop" } });
  assert.equal(env.status, "REJECTED");
  assert.equal((env.error as { code: string }).code, "INVALID_COORDINATE");
  assert.equal(backend.inputCalls.length, 0);
});

test("drag rejects an off-monitor destination", async () => {
  const { ctx, backend } = ctxWith();
  const sid = await sidOf(ctx);
  const env = await run(ctx, { screen_id: sid, from: { x: 10, y: 10, space: "desktop" }, to: { x: 0, y: 99999, space: "desktop" } });
  assert.equal(env.status, "REJECTED");
  assert.equal((env.error as { code: string }).code, "INVALID_COORDINATE");
  assert.equal(backend.inputCalls.length, 0);
});

test("drag: pre-injection foreground change -> REJECTED", async () => {
  const { ctx, backend } = ctxWith();
  backend.failInput = { code: "FOREGROUND_CHANGED", message: "changed", dispatch: "pre" };
  const sid = await sidOf(ctx);
  const env = await run(ctx, { screen_id: sid, from: { x: 10, y: 10, space: "desktop" }, to: { x: 20, y: 20, space: "desktop" } });
  assert.equal(env.status, "REJECTED");
  assert.equal((env.error as { code: string }).code, "FOREGROUND_CHANGED");
});

test("drag success -> CONFIRMED and backend receives resolved endpoints", async () => {
  const { ctx, backend } = ctxWith();
  const sid = await sidOf(ctx);
  const env = await run(ctx, { screen_id: sid, from: { x: 100, y: 100, space: "desktop" }, to: { x: 300, y: 250, space: "desktop" } });
  assert.equal(env.ok, true);
  assert.equal(env.status, "CONFIRMED");
  assert.equal(env.operation, "drag");
  const sent = backend.inputCalls.at(-1) as { action: string; from: { x: number; y: number }; to: { x: number; y: number } };
  assert.equal(sent.action, "drag");
  assert.deepEqual(sent.from, { x: 100, y: 100 });
  assert.deepEqual(sent.to, { x: 300, y: 250 });
});

test("drag: post-dispatch transport failure -> UNCERTAIN", async () => {
  const { ctx, backend } = ctxWith();
  backend.failInput = { code: "BACKEND_ERROR", message: "worker died after dispatch", dispatch: "post" };
  const sid = await sidOf(ctx);
  const env = await run(ctx, { screen_id: sid, from: { x: 10, y: 10, space: "desktop" }, to: { x: 20, y: 20, space: "desktop" } });
  assert.equal(env.status, "UNCERTAIN");
});
