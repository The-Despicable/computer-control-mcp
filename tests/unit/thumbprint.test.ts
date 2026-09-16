import test from "node:test";
import assert from "node:assert/strict";
import { thumbprintDistance } from "../../src/core/util.js";

const base = (v = 128) => Buffer.alloc(64, v);

test("identical images have zero distance", () => {
  assert.equal(thumbprintDistance(base(), base()), 0);
});

test("minor rendering noise stays below a 0.05 threshold", () => {
  const a = base();
  const b = Buffer.from(a);
  for (let i = 0; i < 5; i++) b[i] = 129; // 5 pixels off by one
  assert.ok(thumbprintDistance(a, b) < 0.05, `noise distance was ${thumbprintDistance(a, b)}`);
});

test("a global brightness change is detected (regression: was cancelling out)", () => {
  const a = base(100);
  const b = base(160); // +60 everywhere: mean-normalized structure is identical
  assert.ok(thumbprintDistance(a, b) > 0.1, `brightness distance was ${thumbprintDistance(a, b)}`);
});

test("a structural change is detected", () => {
  const a = Buffer.from(Array.from({ length: 64 }, (_, i) => (i < 32 ? 0 : 255)));
  const b = Buffer.from(Array.from({ length: 64 }, (_, i) => (i < 32 ? 255 : 0)));
  assert.ok(thumbprintDistance(a, b) > 0.1, `structural distance was ${thumbprintDistance(a, b)}`);
});

test("length mismatch is treated as maximal distance", () => {
  assert.equal(thumbprintDistance(Buffer.alloc(64), Buffer.alloc(10)), 1);
});
