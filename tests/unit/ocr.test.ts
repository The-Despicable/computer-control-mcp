import test from "node:test";
import assert from "node:assert/strict";
import { planOcrTiles, collectOcrMatches, type OcrLine } from "../../src/core/ocr.js";
import type { Rect } from "../../src/core/geometry.js";

const region = (r: Rect) => r;

test("planOcrTiles: region within limit is a single tile equal to the region", () => {
  const r = { x: 10, y: 20, w: 100, h: 80 };
  assert.deepEqual(planOcrTiles(r, 4096), [r]);
});

test("planOcrTiles: width over limit tiles horizontally", () => {
  const tiles = planOcrTiles({ x: 0, y: 0, w: 250, h: 100 }, 100);
  assert.deepEqual(tiles, [
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 100, y: 0, w: 100, h: 100 },
    { x: 200, y: 0, w: 50, h: 100 },
  ]);
});

test("planOcrTiles: height over limit tiles vertically (no rows dropped)", () => {
  const tiles = planOcrTiles({ x: 0, y: 0, w: 100, h: 250 }, 100);
  assert.deepEqual(tiles, [
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 0, y: 100, w: 100, h: 100 },
    { x: 0, y: 200, w: 100, h: 50 },
  ]);
  // Every row is covered exactly once.
  const covered = tiles.reduce((s, t) => s + t.h, 0);
  assert.equal(covered, 250);
});

test("planOcrTiles: both dimensions over limit produce a 2D grid", () => {
  const tiles = planOcrTiles({ x: 0, y: 0, w: 250, h: 250 }, 100);
  assert.equal(tiles.length, 9);
  assert.equal(tiles.reduce((s, t) => s + t.w * t.h, 0), 250 * 250);
});

test("planOcrTiles: negative origin (monitor left/above primary) is preserved", () => {
  const tiles = planOcrTiles({ x: -1920, y: -100, w: 100, h: 250 }, 100);
  assert.deepEqual(tiles[0], { x: -1920, y: -100, w: 100, h: 100 });
  assert.deepEqual(tiles[1], { x: -1920, y: 0, w: 100, h: 100 });
  assert.deepEqual(tiles[2], { x: -1920, y: 100, w: 100, h: 50 });
});

test("collectOcrMatches: reconstructs GLOBAL coordinates from a lower vertical tile", async () => {
  const seen: Rect[] = [];
  const res = await collectOcrMatches({
    region: { x: 0, y: 0, w: 100, h: 250 },
    maxDim: 100,
    maxMatches: 50,
    ocrAvailable: true,
    test: () => true,
    runTile: async (tile): Promise<OcrLine[]> => {
      seen.push(tile);
      // Only the second (y=100) tile reports a line, at local y=10.
      if (tile.y === 100) return [{ text: "hello", rect: { x: 5, y: 10, w: 40, h: 8 } }];
      return [];
    },
  });
  assert.equal(seen.length, 3);
  assert.equal(res.matches.length, 1);
  // local (5,10) inside tile origin (0,100) -> global (5,110). NOT (5,10).
  assert.deepEqual(res.matches[0]!.bounds, { x: 5, y: 110, w: 40, h: 8 });
  assert.deepEqual(res.matches[0]!.center, { x: 25, y: 114 });
});

test("collectOcrMatches: full tiling is NOT reported as truncated", async () => {
  const res = await collectOcrMatches({
    region: { x: 0, y: 0, w: 250, h: 250 },
    maxDim: 100,
    maxMatches: 1000,
    ocrAvailable: true,
    test: () => true,
    runTile: async () => [{ text: "x", rect: { x: 0, y: 0, w: 1, h: 1 } }],
  });
  assert.equal(res.tiles_total, 9);
  assert.equal(res.tiles_processed, 9);
  assert.equal(res.tiles_failed, 0);
  assert.equal(res.truncated, false);
});

test("collectOcrMatches: a failed tile is honest truncation, others still processed", async () => {
  const res = await collectOcrMatches({
    region: { x: 0, y: 0, w: 100, h: 250 },
    maxDim: 100,
    maxMatches: 50,
    ocrAvailable: true,
    test: () => true,
    runTile: async (tile) => {
      if (tile.y === 100) throw new Error("tile failed");
      return [{ text: "ok", rect: { x: 0, y: 0, w: 1, h: 1 } }];
    },
  });
  assert.equal(res.tiles_failed, 1);
  assert.equal(res.tiles_processed, 2);
  assert.equal(res.truncated, true);
  assert.equal(res.matches.length, 2);
});

test("collectOcrMatches: maxMatches cap sets truncated=true", async () => {
  const res = await collectOcrMatches({
    region: { x: 0, y: 0, w: 100, h: 100 },
    maxDim: 100,
    maxMatches: 2,
    ocrAvailable: true,
    test: () => true,
    runTile: async () => [
      { text: "a", rect: { x: 0, y: 0, w: 1, h: 1 } },
      { text: "b", rect: { x: 0, y: 0, w: 1, h: 1 } },
      { text: "c", rect: { x: 0, y: 0, w: 1, h: 1 } },
    ],
  });
  assert.equal(res.matches.length, 2);
  assert.equal(res.truncated, true);
});

test("collectOcrMatches: predicate filters lines", async () => {
  const res = await collectOcrMatches({
    region: { x: 0, y: 0, w: 100, h: 100 },
    maxDim: 100,
    maxMatches: 50,
    ocrAvailable: true,
    test: (t) => t.includes("Save"),
    runTile: async () => [
      { text: "Cancel", rect: { x: 0, y: 0, w: 1, h: 1 } },
      { text: "Save as", rect: { x: 2, y: 3, w: 4, h: 5 } },
    ],
  });
  assert.deepEqual(res.matches.map(m => m.text), ["Save as"]);
  assert.equal(res.truncated, false);
});
