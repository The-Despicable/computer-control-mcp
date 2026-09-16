import test from "node:test";
import assert from "node:assert/strict";
import { evaluateReadProvenance, type ReadIdentityEvidence } from "../../src/core/target-binding.js";

const ev = (over: Partial<ReadIdentityEvidence> = {}): ReadIdentityEvidence => ({
  hwnd: 1, start_pid: 100, end_pid: 100, window_valid: true, ...over,
});

test("unbound read with stable identity is accepted", () => {
  assert.deepEqual(evaluateReadProvenance(null, ev()), { ok: true });
});

test("bound read with matching hwnd+pid is accepted", () => {
  assert.deepEqual(evaluateReadProvenance({ hwnd: 1, pid: 100 }, ev()), { ok: true });
});

test("bound hwnd differs from the hwnd actually read -> FOREGROUND_CHANGED", () => {
  const v = evaluateReadProvenance({ hwnd: 42, pid: 100 }, ev({ hwnd: 1 }));
  assert.equal(v.ok, false);
  assert.equal((v as { code: string }).code, "FOREGROUND_CHANGED");
});

test("hwnd reused by another process (bound pid 100, observed 999) -> STALE_SCREEN", () => {
  const v = evaluateReadProvenance({ hwnd: 1, pid: 100 }, ev({ start_pid: 999, end_pid: 999 }));
  assert.equal(v.ok, false);
  assert.equal((v as { code: string }).code, "STALE_SCREEN");
});

test("owner PID changes during the read -> STALE_SCREEN", () => {
  const v = evaluateReadProvenance(null, ev({ start_pid: 100, end_pid: 200 }));
  assert.equal(v.ok, false);
  assert.equal((v as { code: string }).code, "STALE_SCREEN");
});

test("destroyed window (window_valid false) -> STALE_SCREEN", () => {
  const v = evaluateReadProvenance({ hwnd: 1, pid: 100 }, ev({ window_valid: false }));
  assert.equal(v.ok, false);
  assert.equal((v as { code: string }).code, "STALE_SCREEN");
});

test("window vanished mid-read (end_pid 0) -> STALE_SCREEN", () => {
  const v = evaluateReadProvenance(null, ev({ end_pid: 0 }));
  assert.equal(v.ok, false);
  assert.equal((v as { code: string }).code, "STALE_SCREEN");
});

test("no owner before the read (start_pid 0) -> STALE_SCREEN", () => {
  const v = evaluateReadProvenance(null, ev({ start_pid: 0, end_pid: 0 }));
  assert.equal(v.ok, false);
});

test("bound pid only (no hwnd) is still enforced", () => {
  const v = evaluateReadProvenance({ pid: 100 }, ev({ start_pid: 555, end_pid: 555 }));
  assert.equal(v.ok, false);
  assert.equal((v as { code: string }).code, "STALE_SCREEN");
});

test("title is not part of identity (no title in evidence -> unaffected)", () => {
  // Identity is hwnd+pid only; a title change cannot be represented and must not
  // invalidate a read.
  assert.deepEqual(evaluateReadProvenance({ hwnd: 1, pid: 100 }, ev()), { ok: true });
});
