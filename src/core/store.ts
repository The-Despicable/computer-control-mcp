import { fail } from "./errors.js";
import type { ForegroundInfo } from "./policy.js";
import type { Monitor, Rect } from "./geometry.js";
import { makeScreenId } from "./util.js";

export interface Observation {
  screen_id: string;
  seq: number;
  timestamp: number;               // epoch ms, captured on the Windows side
  has_image: boolean;
  image_format?: "png" | "jpeg";
  width?: number; height?: number; // image pixels
  origin: { x: number; y: number };
  scale: number;                   // image px per desktop px
  region: Rect;                   // captured desktop region
  monitors: Monitor[];
  virtual_screen: Rect;
  foreground: ForegroundInfo | null;
  cursor?: { x: number; y: number } | null;
  thumbprint?: Buffer;             // 64-byte 8x8 grayscale perceptual hash
  ui?: unknown;                    // optional UIA summary
}

export interface StateLike {
  monitors: Monitor[]; virtual_screen: Rect; foreground: ForegroundInfo | null;
  cursor?: { x: number; y: number } | null; timestamp: number;
}

export class ObservationStore {
  private map = new Map<string, Observation>();
  private seq = 0;
  constructor(private maxEntries: number, private maxAgeMs: number, private now: () => number = () => Date.now()) {}

  addBinding(s: StateLike, extra?: Partial<Observation>): Observation {
    const obs: Observation = {
      screen_id: makeScreenId(this.seq), seq: this.seq++, timestamp: s.timestamp || this.now(),
      has_image: false, origin: { x: 0, y: 0 }, scale: 1,
      region: s.virtual_screen, monitors: s.monitors, virtual_screen: s.virtual_screen,
      foreground: s.foreground, cursor: s.cursor, ...extra,
    };
    this.put(obs);
    return obs;
  }

  addImage(cap: {
    screenshot_b64: string; format: "png" | "jpeg"; width: number; height: number;
    origin: { x: number; y: number }; scale: number; region: Rect; thumbprint_b64: string;
    monitors: Monitor[]; virtual_screen: Rect; foreground: ForegroundInfo | null;
    cursor?: { x: number; y: number } | null; timestamp: number;
  }, ui?: unknown): Observation {
    return this.addBinding(cap, {
      has_image: true, image_format: cap.format, width: cap.width, height: cap.height,
      origin: cap.origin, scale: cap.scale || 1, region: cap.region,
      thumbprint: Buffer.from(cap.thumbprint_b64, "base64"), ui,
    });
  }

  get(id: string): Observation | undefined { return this.map.get(id); }

  /** Freshness gate for every mutation: NO_OBSERVATION if absent, STALE_SCREEN if unknown/expired. */
  require(screenId: string | undefined): Observation {
    if (!screenId || typeof screenId !== "string" || !screenId.trim())
      fail("NO_OBSERVATION", "mutation requires a screen_id from a recent observation",
        undefined, "call observe() (or find_text/find_element/window_focus) and pass its screen_id");
    const obs = this.map.get(screenId as string);
    if (!obs) fail("STALE_SCREEN", `unknown screen_id ${screenId} (server restarted or cache evicted)`,
      undefined, "re-observe the desktop, then retry with the new screen_id");
    const age = this.now() - (obs as Observation).timestamp;
    if (age > this.maxAgeMs) fail("STALE_SCREEN",
      `observation is too old (${age}ms > ${this.maxAgeMs}ms limit)`, { screen_id: screenId, age, limit: this.maxAgeMs },
      "call observe() (or find_text) to obtain a fresh screen_id, then retry immediately");
    return obs as Observation;
  }

  private put(obs: Observation) {
    this.map.set(obs.screen_id, obs);
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
}
