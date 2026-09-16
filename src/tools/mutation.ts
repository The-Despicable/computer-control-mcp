import { newMutationReceipt, confirmedReceipt, rejectReceipt, type MutationReceipt } from "../core/receipt.js";
import { toToolError } from "../core/errors.js";
import { okResult, type ToolOkResult } from "../core/result.js";
import type { Observation } from "../core/store.js";

/** Create the execution record for one mutation before any validation runs. */
export function beginMutation(operation: string, screenId?: string): MutationReceipt {
  const r = newMutationReceipt(operation);
  if (screenId) r.screen_id = screenId;
  return r;
}

/** Fill in the bound observation once validation has produced one. */
export function noteBinding(receipt: MutationReceipt, obs: Observation): void {
  receipt.screen_id = obs.screen_id;
  if (obs.foreground) receipt.target_hwnd = obs.foreground.hwnd;
}

/** Successful mutation result: CONFIRMED plus the receipt fields. */
export function mutationSuccess(tool: string, receipt: MutationReceipt, data: Record<string, unknown>): ToolOkResult {
  return okResult(tool, { ...data, ...confirmedReceipt(receipt) });
}

/**
 * Classify a thrown mutation error and rethrow with the receipt attached.
 *   pre-dispatch  -> REJECTED  (nothing was sent)
 *   post-dispatch -> UNCERTAIN (dispatch may have happened)
 * The MCP never retries here; the worker/session layer interprets UNCERTAIN.
 */
export function mutationFailure(e: unknown, receipt: MutationReceipt): never {
  const te = toToolError(e);
  const status = te.dispatch === "post" ? "UNCERTAIN" : "REJECTED";
  te.receipt = rejectReceipt(receipt, te.code, status);
  throw te;
}
