import { randomUUID } from "node:crypto";

/**
 * Mutation outcome semantics. These three states must never be collapsed:
 *
 *   CONFIRMED  the MCP has evidence the requested mutation was dispatched and
 *              the backend reported success.
 *   REJECTED   the MCP knows the mutation was NOT executed because validation
 *              or policy failed before dispatch (stale screen_id, denied
 *              policy, bad coordinate, unknown key, ...).
 *   UNCERTAIN  dispatch may have happened, but the MCP cannot establish whether
 *              the operation landed (transport timeout, worker death after the
 *              request was written, truncated communication).
 *
 * The MCP reports evidence only. It never retries or compensates; interpreting
 * UNCERTAIN belongs to the worker/session layer.
 */
export type MutationStatus = "CONFIRMED" | "REJECTED" | "UNCERTAIN";

/** A per-mutation execution record attached to results and errors. */
export interface MutationReceipt {
  mutation_id: string;
  operation: string;
  timestamp: number;
  status: MutationStatus;
  screen_id?: string;
  target_hwnd?: number;
  reason?: string;
}

export function newMutationReceipt(operation: string): MutationReceipt {
  return { mutation_id: `mut-${randomUUID()}`, operation, timestamp: Date.now(), status: "REJECTED" };
}

/** Fields spread into a successful tool result. */
export function confirmedReceipt(receipt: MutationReceipt): Record<string, unknown> {
  return {
    status: "CONFIRMED" as const,
    mutation_id: receipt.mutation_id,
    operation: receipt.operation,
    mutation_timestamp: receipt.timestamp,
    ...(receipt.screen_id ? { screen_id: receipt.screen_id } : {}),
  };
}

/** Fields attached to a ToolError so `errorResult` can expose them. */
export function rejectReceipt(receipt: MutationReceipt, reason: string, status: MutationStatus = "REJECTED"): MutationReceipt {
  return { ...receipt, status, reason };
}
