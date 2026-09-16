import type { z } from "zod";
import { fail } from "../core/errors.js";

/**
 * Parse untrusted MCP tool arguments once at the handler boundary.
 * Zod failures become structured INVALID_ARGUMENT (never INTERNAL_ERROR),
 * so malformed input is always a client error with a usable hint.
 */
export function parseToolArgs<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const detail = r.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    fail("INVALID_ARGUMENT", `invalid tool arguments: ${detail}`,
      { issues: r.error.issues }, "check tools/list for the schema and retry with corrected arguments");
  }
  return r.data;
}
