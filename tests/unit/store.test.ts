import test from "node:test";
import assert from "node:assert/strict";
import { ObservationStore } from "../../src/core/store.js";

const state = (t: number) => ({ monitors: [{ index: 0, x: 0, y: 0, w: 1920, h: 1080, scale: 1 as number | null, primary: true, device: "d" }],
  virtual_screen: { x: 0, y: 0, w: 1920, h: 1080 },
  foreground: { hwnd: 42, pid: 1000, process: "app", title: "App", bounds: { x: 0, y: 0, w: 800, h: 600 } }, timestamp: t });

test("screen_id format is stable and opaque", () => {
  const s = new ObservationStore(8, 30000);
  const o = s.addBinding(state(1000));
  assert.match(o.screen_id, /^scr-\d+-[a-z0-9]+-[a-f0-9]{4}$/);
});

test("missing screen_id -> NO_OBSERVATION; unknown -> STALE_SCREEN; expired -> STALE_SCREEN", () => {
  let now = 100000;
  const s = new ObservationStore(8, 1000, () => now);
  assert.throws(() => s.require(undefined), /NO_OBSERVATION/);
  assert.throws(() => s.require("scr-1-x-ffff"), /STALE_SCREEN/);
  const o = s.addBinding(state(now));
  assert.equal(s.require(o.screen_id).screen_id, o.screen_id);
  now += 2000; // age out
  assert.throws(() => s.require(o.screen_id), /STALE_SCREEN/);
});

test("LRU eviction bounded by cache size", () => {
  const s = new ObservationStore(4, 999999999);
  const ids = [0, 1, 2, 3, 4].map(i => s.addBinding(state(1000 + i)).screen_id);
  const first = ids[0] as string;
  const last = ids[4] as string;
  assert.equal(s.get(first), undefined);
  assert.ok(s.get(last));
});
