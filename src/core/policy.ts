import { fail } from "./errors.js";

export interface ForegroundInfo {
  hwnd: number; pid: number; process: string; title: string;
  bounds: { x: number; y: number; w: number; h: number };
}

export interface PolicyState {
  inputEnabled: boolean;
  allowedPids: Set<number> | null;
  allowedTitleSubstrings: string[] | null;
  maxObservationAgeMs: number;
  observationCache: number;
  maxImageBytes: number;
}

export class Policy implements PolicyState {
  inputEnabled = false;
  allowedPids: Set<number> | null = null;
  allowedTitleSubstrings: string[] | null = null;
  maxObservationAgeMs = 30000;
  observationCache = 32;
  maxImageBytes = 12 * 1024 * 1024;

  static load(): Policy {
    const p = new Policy();
    const env = (k: string, d?: string) => process.env[k] ?? d;
    p.inputEnabled = ["1", "true", "yes"].includes(((env("COMPUTER_CONTROL_INPUT_ENABLED", "false") ?? "").toLowerCase()));
    const csv = (k: string) => ((env(k, "") ?? "").split(",").map(s => s.trim()).filter(Boolean));
    const pids = csv("COMPUTER_CONTROL_ALLOWED_PIDS").map(Number).filter(Number.isInteger);
    p.allowedPids = pids.length ? new Set(pids) : null;
    const titles = csv("COMPUTER_CONTROL_ALLOWED_WINDOW_TITLES").map(s => s.toLowerCase());
    p.allowedTitleSubstrings = titles.length ? titles : null;
    const maxAge = Number(env("COMPUTER_CONTROL_MAX_OBSERVATION_AGE_MS", "30000"));
    p.maxObservationAgeMs = Math.max(1000, Number.isFinite(maxAge) ? maxAge : 30000);
    const cache = Number(env("COMPUTER_CONTROL_OBSERVATION_CACHE", "32"));
    p.observationCache = Math.max(4, Number.isFinite(cache) ? cache : 32);
    const imgMb = Number(env("COMPUTER_CONTROL_MAX_IMAGE_MB", "12"));
    p.maxImageBytes = Math.max(1, Number.isFinite(imgMb) ? imgMb : 12) * 1024 * 1024;
    return p;
  }

  assertInputEnabled() {
    if (!this.inputEnabled)
      fail("POLICY_DENIED", "computer input is disabled on this server (observe-only mode)",
        { env: "COMPUTER_CONTROL_INPUT_ENABLED" }, "set COMPUTER_CONTROL_INPUT_ENABLED=true to allow mutations");
  }

  assertWindowAllowed(fg: ForegroundInfo | null) {
    if (!fg) return;
    if (this.allowedPids && !this.allowedPids.has(fg.pid))
      fail("POLICY_DENIED", `foreground window (pid ${fg.pid}, "${fg.title}") is not in the allowed PID allowlist`,
        { allowed_pids: [...this.allowedPids], foreground: fg }, "focus an allowed window (window_focus/window_list)");
    if (this.allowedTitleSubstrings && !this.allowedTitleSubstrings.some(t => (fg.title ?? "").toLowerCase().includes(t)))
      fail("POLICY_DENIED", `foreground window title "${fg.title}" does not match the allowed title substrings`,
        { allowed_titles: this.allowedTitleSubstrings, foreground: fg });
  }
}
