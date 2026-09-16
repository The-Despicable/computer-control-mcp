import type { ErrorCode } from "./errors.js";

/**
 * Target-provenance policy for read_text.
 *
 * A read bound to target A must return A's content, or an explicit
 * target-invalidated outcome — never B's content while reporting success for A.
 *
 * The PowerShell primitive supplies identity evidence captured around the UIA
 * read (owner PID before and after, and whether the window still exists). This
 * function is the deterministic decision over that evidence; it is pure so it
 * can be unit-tested without Windows.
 *
 * Identity is HWND + owning PID. Title is deliberately NOT part of identity: a
 * window whose title changes is still the same window.
 */
export interface BoundTarget {
  hwnd?: number;
  pid?: number;
}

export interface ReadIdentityEvidence {
  hwnd: number;
  /** Owner PID observed immediately before the UIA read. */
  start_pid: number;
  /** Owner PID observed immediately after the UIA read. */
  end_pid: number;
  /** True if the bound HWND still existed after the read. */
  window_valid: boolean;
}

export type ProvenanceVerdict =
  | { ok: true }
  | { ok: false; code: ErrorCode; reason: string };

export function evaluateReadProvenance(bound: BoundTarget | null, observed: ReadIdentityEvidence): ProvenanceVerdict {
  // The bound HWND must be the one actually read.
  if (bound && bound.hwnd !== undefined && bound.hwnd !== observed.hwnd) {
    return { ok: false, code: "FOREGROUND_CHANGED", reason: "bound window is not the window that was read" };
  }
  // A window that no longer exists cannot have produced trustworthy text.
  if (!observed.window_valid) {
    return { ok: false, code: "STALE_SCREEN", reason: "target window no longer exists; text discarded" };
  }
  // end_pid 0 means the HWND was destroyed during the read.
  if (observed.start_pid === 0 || observed.end_pid === 0) {
    return { ok: false, code: "STALE_SCREEN", reason: "target window vanished during read; text discarded" };
  }
  // The same HWND must have the same owner before and after the read.
  if (observed.start_pid !== observed.end_pid) {
    return { ok: false, code: "STALE_SCREEN", reason: "target window changed during read (hwnd reused); text discarded" };
  }
  // The owner PID must match the binding: catches HWND reuse by another process
  // that occurred before the read resolved its UIA root.
  if (bound && bound.pid !== undefined && bound.pid !== observed.start_pid) {
    return { ok: false, code: "STALE_SCREEN", reason: "bound window identity changed (hwnd reused by another process); text discarded" };
  }
  return { ok: true };
}
