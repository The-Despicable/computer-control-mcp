import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { PsPool } from "../../src/windows-backend/worker.js";
import { toToolError } from "../../src/core/errors.js";

const FAKE = fileURLToPath(new URL("./fake-worker.js", import.meta.url));

function makePool(size = 1, timeout = 3000): PsPool {
  return new PsPool({ exe: process.execPath, args: [FAKE], size, requestTimeoutMs: timeout });
}

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
