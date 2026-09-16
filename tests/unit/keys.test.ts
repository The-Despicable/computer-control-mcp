import test from "node:test";
import assert from "node:assert/strict";
import { parseChord, normalizeKeyName } from "../../src/core/keys.js";

test("aliases normalize", () => {
  assert.equal(normalizeKeyName("Return"), "enter");
  assert.equal(normalizeKeyName("ESC"), "escape");
  assert.equal(normalizeKeyName("cmd"), "win");
  assert.equal(normalizeKeyName("bogus-key-xyz"), null);
});

test("unknown key -> UNKNOWN_KEY, nothing parsed through", () => {
  assert.throws(() => parseChord("ctrl+notakey"), /UNKNOWN_KEY/);
});

test("modifier-only chord rejected", () => {
  assert.throws(() => parseChord("shift"), /INVALID_ARGUMENT/);
  assert.throws(() => parseChord("ctrl+alt"), /INVALID_ARGUMENT/);
});

test("chord order is deterministic: ctrl,alt,shift, then main key", () => {
  const c = parseChord("t+shift+alt+ctrl");
  assert.deepEqual(c.map(k => k.vk), [0x11, 0x12, 0x10, 0x54]);
});

test("extended keys flagged", () => {
  const left = parseChord("left");
  assert.equal(left.length, 1);
  assert.equal(left[0]?.ext, true);
  const a = parseChord("a");
  assert.equal(a[0]?.ext, false);
});

test("single non-modifier keys parse", () => {
  assert.equal(parseChord("enter").length, 1);
  assert.equal(parseChord("f5")[0]?.vk, 0x74);
});
