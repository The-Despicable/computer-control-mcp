import type { MutationReceipt } from "./receipt.js";

export type ErrorCode =
  | "NO_OBSERVATION" | "STALE_SCREEN" | "FOREGROUND_CHANGED" | "INVALID_COORDINATE"
  | "UNKNOWN_KEY" | "POLICY_DENIED" | "TIMEOUT" | "ACTION_FAILED"
  | "WINDOW_NOT_FOUND" | "INVALID_ARGUMENT" | "BACKEND_ERROR" | "INTERNAL_ERROR";

/**
 * Where a failure occurred relative to dispatching input to Windows.
 *   pre  -> nothing was sent; the mutation is safely REJECTED.
 *   post -> the request may already have reached Windows; outcome is UNCERTAIN.
 */
export type DispatchPhase = "pre" | "post";

export class ToolError extends Error {
  public dispatch: DispatchPhase = "pre";
  public receipt?: MutationReceipt;
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
    public readonly hint?: string,
  ) { super(`[${code}] ${message}`); }
}

export function fail(code: ErrorCode, message: string, details?: unknown, hint?: string): never {
  throw new ToolError(code, message, details, hint);
}

const PS_CODES = new Set<ErrorCode>([
  "FOREGROUND_CHANGED", "STALE_SCREEN", "INVALID_COORDINATE", "WINDOW_NOT_FOUND",
  "INVALID_ARGUMENT", "ACTION_FAILED", "BACKEND_ERROR",
]);

export function normalizePsCode(code: string): ErrorCode {
  return PS_CODES.has(code as ErrorCode) ? (code as ErrorCode) : "BACKEND_ERROR";
}

export function toToolError(e: unknown): ToolError {
  if (e instanceof ToolError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  return new ToolError("INTERNAL_ERROR", msg, undefined, "this is a bug in the MCP server; report it");
}
