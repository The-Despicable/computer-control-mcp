import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function log(level: "debug" | "info" | "error", msg: string, extra?: unknown) {
  const min = process.env.COMPUTER_CONTROL_LOG === "debug" ? 0 : process.env.COMPUTER_CONTROL_LOG === "error" ? 2 : 1;
  const rank = level === "debug" ? 0 : level === "info" ? 1 : 2;
  if (rank >= min) console.error(`[computer-control][${level}] ${msg}`, extra !== undefined ? JSON.stringify(extra) : "");
}

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// Minimal promise-chain lock for MUTATIONS ONLY (input/focus). Reads and waits
// must never hold it — otherwise a 60s wait_for_text starves observe.
let mutationChain: Promise<unknown> = Promise.resolve();
export function withMutationLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = mutationChain.then(fn, fn);
  mutationChain = next.catch(() => {});
  return next;
}

/** Back-compat alias: historically wrapped every tool. Now scoped to mutations. */
export const withLock = withMutationLock;

export function loadEnvFile() {
  for (const p of [join(process.cwd(), ".env")]) {
    if (!existsSync(p)) continue;
    try {
      for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
        if (!m || line.trim().startsWith("#")) continue;
        const v = (m[2] ?? "").replace(/^["']|["']$/g, "");
        const k = m[1] as string;
        if (process.env[k] === undefined) process.env[k] = v; // real env wins
      }
    } catch { /* non-fatal */ }
  }
}

export function makeScreenId(seq: number): string {
  const t = Date.now().toString(36);
  const r = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  return `scr-${seq}-${t}-${r}`;
}

/**
 * Perceptual distance between two 64-byte 8x8 grayscale thumbprints.
 *
 * Combines a mean-normalized structural term (shape/layout) with an absolute
 * luminance term so a pure global brightness change is detected instead of
 * cancelling out. Small rendering noise stays below typical thresholds.
 */
export function thumbprintDistance(a: Buffer, b: Buffer): number {
  if (a.length !== b.length || a.length === 0) return 1;
  const mean = (x: Buffer) => x.reduce((s, v) => s + v, 0) / x.length;
  const ma = mean(a), mb = mean(b);
  let structural = 0;
  for (let i = 0; i < a.length; i++) structural += Math.abs(((a[i] as number) - ma) - ((b[i] as number) - mb));
  structural = structural / a.length / 255;
  const brightness = Math.abs(ma - mb) / 255;
  const d = structural + brightness;
  return Math.min(1, Math.max(0, d));
}

export function monitorsHash(monitors: Array<{ x: number; y: number; w: number; h: number }>): string {
  return monitors.map(m => `${m.x},${m.y},${m.w},${m.h}`).join("|");
}
