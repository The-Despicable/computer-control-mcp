import { fail } from "./errors.js";

/**
 * Bound model-controlled regex evaluation. Two layers:
 *   1. this TS-side pre-validation (length cap + syntax) rejects abusive
 *      patterns before any worker is asked to evaluate them;
 *   2. the PowerShell side compiles the pattern with an explicit .NET
 *      matchTimeout, so a pathological pattern cannot stall perception.
 * The final matcher is never run unbounded.
 */
export const MAX_REGEX_LENGTH = 500;

export function assertSafeRegex(pattern: string | undefined): void {
  if (typeof pattern !== "string") return;
  if (pattern.length === 0) fail("INVALID_ARGUMENT", "regex must be a non-empty string");
  if (pattern.length > MAX_REGEX_LENGTH)
    fail("INVALID_ARGUMENT", `regex exceeds the ${MAX_REGEX_LENGTH}-character limit`, { length: pattern.length });
  try {
    new RegExp(pattern);
  } catch (e) {
    fail("INVALID_ARGUMENT", `invalid regex: ${e instanceof Error ? e.message : String(e)}`);
  }
}
