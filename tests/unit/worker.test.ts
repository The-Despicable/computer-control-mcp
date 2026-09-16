import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { PsPool } from "../../src/windows-backend/worker.js";
import { toToolError } from "../../src/core/errors.js";

const FAKE = fileURLToPath(new URL("./fake-worker.js", import.meta.url));

function makePool(size = 1, timeout = 3000): PsPool {
  return new PsPool({ exe: process.execPath, args: [FAKE], size, requestTimeoutMs: timeout });
}
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

test("worker startup + a request round-trips", async () => {
  const pool = makePool(1);
  try {
    const r = await pool.run<{ script: string; payload: { n: number } }>("echo", { n: 1 });
    assert.equal(r.script, "echo");
    assert.deepEqual(r.payload, { n: 1 });
  } finally { await pool.close(); }
});

test("sequential calls on one persistent worker", async () => {
  const pool = makePool(1);
  try {
    for (let i = 0; i < 4; i++) {
      const r = await pool.run<{ payload: { i: number } }>("echo", { i });
      assert.equal(r.payload.i, i);
    }
  } finally { await pool.close(); }
});

test("concurrent calls are correlated to the right response", async () => {
  const pool = makePool(2);
  try {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => pool.run<{ payload: { i: number } }>("echo", { i }))
    );
    results.forEach((r, i) => assert.equal(r.payload.i, i));
  } finally { await pool.close(); }
});

test("structured worker error -> pre-dispatch (REJECTED) with the original code", async () => {
  const pool = makePool(1);
  try {
    await assert.rejects(pool.run("fail", {}), (e: unknown) => {
      const te = toToolError(e);
      assert.equal(te.code, "INVALID_ARGUMENT");
      assert.equal(te.dispatch, "pre");
      return true;
    });
  } finally { await pool.close(); }
});

test("timeout -> post-dispatch (UNCERTAIN) and the worker is replaced", async () => {
  const pool = makePool(1, 200);
  try {
    await assert.rejects(pool.run("hang", {}), (e: unknown) => {
      assert.equal(toToolError(e).dispatch, "post");
      return true;
    });
    // The hung worker was killed; the pool must still serve requests.
    const r = await pool.run<{ payload: { ok: boolean } }>("echo", { ok: true });
    assert.deepEqual(r.payload, { ok: true });
  } finally { await pool.close(); }
});

test("worker crash -> post-dispatch (UNCERTAIN), then a safe restart", async () => {
  const pool = makePool(1, 2000);
  try {
    await assert.rejects(pool.run("crash", {}), (e: unknown) => {
      assert.equal(toToolError(e).dispatch, "post");
      return true;
    });
    const r = await pool.run<{ payload: { after: string } }>("echo", { after: "crash" });
    assert.deepEqual(r.payload, { after: "crash" });
  } finally { await pool.close(); }
});

test("malformed worker response is ignored and becomes a post-dispatch timeout", async () => {
  const pool = makePool(1, 250);
  try {
    await assert.rejects(pool.run("garbage", {}), (e: unknown) => {
      assert.equal(toToolError(e).dispatch, "post");
      return true;
    });
  } finally { await pool.close(); }
});

test("shutdown: no requests after close", async () => {
  const pool = makePool(1);
  await pool.close();
  await assert.rejects(pool.run("echo", {}), (e: unknown) => {
    assert.match(toToolError(e).message, /closed/i);
    return true;
  });
});

test("contention proof: within one lane, a short op queues behind a slow op", async () => {
  const pool = new PsPool({ exe: process.execPath, args: [FAKE], controlSize: 1, perceptionSize: 1, requestTimeoutMs: 4000 });
  try {
    await pool.run("echo", {}); // warm
    const slow = pool.run("delay", { ms: 500 }, 4000, "perception");
    await sleep(30);
    const t0 = Date.now();
    await pool.run("echo", {}, 4000, "perception");
    const waited = Date.now() - t0;
    await slow;
    assert.ok(waited >= 200, `expected the short op to queue behind the slow one, waited ${waited}ms`);
  } finally { await pool.close(); }
});

test("lane isolation: a slow perception op does NOT starve a control op", async () => {
  const pool = new PsPool({ exe: process.execPath, args: [FAKE], controlSize: 1, perceptionSize: 1, requestTimeoutMs: 4000 });
  try {
    await pool.run("echo", {}, 4000, "control"); // warm the control worker
    const slow = pool.run("delay", { ms: 600 }, 4000, "perception");
    await sleep(50);
    const t0 = Date.now();
    const r = await pool.run<{ payload: { lane: string } }>("echo", { lane: "control" }, 4000, "control");
    const controlMs = Date.now() - t0;
    await slow;
    assert.equal(r.payload.lane, "control");
    assert.ok(controlMs < 250, `control op waited ${controlMs}ms behind perception`);
  } finally { await pool.close(); }
});
