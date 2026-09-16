import { fail } from "./errors.js";

export interface Rect { x: number; y: number; w: number; h: number }
export interface Monitor { index: number; x: number; y: number; w: number; h: number; scale: number | null; primary: boolean; device: string }

export function rectsEqual(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

export function pointInRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

/** Desktop-absolute point -> observation-image pixel point (origin + scale). */
export function desktopToImage(x: number, y: number, o: { origin: { x: number; y: number }; scale: number }) {
  return { x: Math.round((x - o.origin.x) * o.scale), y: Math.round((y - o.origin.y) * o.scale) };
}

/** Observation-image pixel point -> desktop-absolute point (inverse origin + scale). */
export function imageToDesktop(x: number, y: number, o: { origin: { x: number; y: number }; scale: number }) {
  return { x: Math.round(o.origin.x + x / o.scale), y: Math.round(o.origin.y + y / o.scale) };
}

export interface ClickSpaceInput {
  space: "image" | "desktop" | "monitor";
  x: number; y: number;
  monitor?: number;
}

export interface GeometryBinding {
  has_image: boolean;
  width?: number; height?: number;
  origin: { x: number; y: number };
  scale: number;
  monitors: Monitor[];
  virtual_screen: Rect;
}

/**
 * Resolves and validates click/scroll coordinates against the bound observation.
 * NEVER clamps: anything outside a real monitor (or the image, in image-space) is
 * rejected with INVALID_COORDINATE.
 */
export function resolvePoint(a: ClickSpaceInput, obs: GeometryBinding): { x: number; y: number } {
  if (a.space === "image") {
    if (!obs.has_image) fail("INVALID_ARGUMENT",
      "image-space coordinates require a screen_id produced by observe() (this binding is imageless)",
      undefined, "call observe() first, or pass space:'desktop'");
    const w = obs.width as number, h = obs.height as number;
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || a.x < 0 || a.y < 0 || a.x >= w || a.y >= h)
      fail("INVALID_COORDINATE", `point (${a.x},${a.y}) is outside the captured image (${w}x${h})`);
    return imageToDesktop(a.x, a.y, obs);
  }
  if (a.space === "monitor") {
    const m = obs.monitors.find(mm => mm.index === a.monitor);
    if (!m) fail("INVALID_ARGUMENT", `unknown monitor index ${a.monitor}`, { monitors: obs.monitors.map(mm => mm.index) });
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y))
      fail("INVALID_COORDINATE", `non-finite monitor-relative point (${a.x},${a.y})`);
    const p = { x: (m as Monitor).x + Math.round(a.x), y: (m as Monitor).y + Math.round(a.y) };
    if (!pointInRect(p.x, p.y, m as Monitor)) fail("INVALID_COORDINATE", `point (${a.x},${a.y}) relative to monitor ${(m as Monitor).index} falls outside it`);
    return p;
  }
  // desktop space: must be on an actual monitor — dead space between monitors is rejected.
  if (!Number.isFinite(a.x) || !Number.isFinite(a.y))
    fail("INVALID_COORDINATE", `non-finite desktop point (${a.x},${a.y})`);
  const onMonitor = obs.monitors.some(m => pointInRect(a.x, a.y, m));
  if (!onMonitor) fail("INVALID_COORDINATE",
    `desktop point (${a.x},${a.y}) is not on any monitor`, { virtual_screen: obs.virtual_screen, monitors: obs.monitors },
    "re-observe and use a valid target point");
  return { x: Math.round(a.x), y: Math.round(a.y) };
}
