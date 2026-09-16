import test from "node:test";
import assert from "node:assert/strict";
import { resolvePoint, imageToDesktop, desktopToImage } from "../../src/core/geometry.js";

const baseObs = {
  has_image: true, width: 960, height: 540, origin: { x: 100, y: -200 }, scale: 0.5,
  monitors: [{ index: 0, x: 0, y: 0, w: 1920, h: 1080, scale: 1, primary: true, device: "\\\\.\\DISPLAY1" }],
  virtual_screen: { x: 0, y: 0, w: 1920, h: 1080 },
};

test("image -> desktop mapping uses origin + inverse scale", () => {
  const p = imageToDesktop(480, 270, baseObs);
  assert.deepEqual(p, { x: 100 + 960, y: -200 + 540 });
});

test("desktop -> image round trip", () => {
  const p = imageToDesktop(100, 50, baseObs);
  assert.deepEqual(desktopToImage(p.x, p.y, baseObs), { x: 100, y: 50 });
});

test("image coords outside the image are rejected, never clamped", () => {
  assert.throws(() => resolvePoint({ space: "image", x: 5000, y: 0 }, baseObs), /INVALID_COORDINATE/);
  assert.throws(() => resolvePoint({ space: "image", x: -1, y: 0 }, baseObs), /INVALID_COORDINATE/);
});

test("desktop dead space (negative off-monitor) is rejected", () => {
  assert.throws(() => resolvePoint({ space: "desktop", x: -500, y: -500 }, baseObs), /INVALID_COORDINATE/);
});

test("non-finite desktop points are rejected", () => {
  assert.throws(() => resolvePoint({ space: "desktop", x: NaN, y: 0 }, baseObs), /INVALID_COORDINATE/);
});

test("monitor-relative coordinates resolve against the monitor origin", () => {
  const p = resolvePoint({ space: "monitor", monitor: 0, x: 10, y: 20 }, baseObs);
  assert.deepEqual(p, { x: 10, y: 20 });
  assert.throws(() => resolvePoint({ space: "monitor", monitor: 0, x: 99999, y: 0 }, baseObs), /INVALID_COORDINATE/);
});

test("image-space with an imageless binding is INVALID_ARGUMENT", () => {
  assert.throws(() => resolvePoint({ space: "image", x: 1, y: 1 }, { ...baseObs, has_image: false }), /INVALID_ARGUMENT/);
});

test("negative desktop origins resolve (monitor at negative offset)", () => {
  const obsNeg = {
    ...baseObs,
    monitors: [{ index: 0, x: -1920, y: 0, w: 1920, h: 1080, scale: 1, primary: false, device: "\\\\.\\DISPLAY2" }],
    virtual_screen: { x: -1920, y: 0, w: 1920, h: 1080 },
  };
  assert.deepEqual(resolvePoint({ space: "desktop", x: -1910, y: 100 }, obsNeg), { x: -1910, y: 100 });
  assert.throws(() => resolvePoint({ space: "desktop", x: 10, y: 10 }, obsNeg), /INVALID_COORDINATE/);
});
