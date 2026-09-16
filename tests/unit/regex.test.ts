import test from "node:test";
import assert from "node:assert/strict";
import { assertSafeRegex, MAX_REGEX_LENGTH } from "../../src/core/regex.js";
import { ctxWith, envelope } from "./support.js";
import { findText } from "../../src/tools/perception.js";
import { waitForText } from "../../src/tools/wait.js";

test("ordinary patterns are accepted", () => {
  assertSafeRegex("build succeeded");
  assertSafeRegex("^Save( as)?$");
  assertSafeRegex("\\d{2,4}");
});

test("invalid patterns are rejected as INVALID_ARGUMENT", () => {
  assert.throws(() => assertSafeRegex("("), /INVALID_ARGUMENT/);
  assert.throws(() => assertSafeRegex("a{2,1}"), /INVALID_ARGUMENT/);
});

test("empty pattern is rejected", () => {
  assert.throws(() => assertSafeRegex(""), /INVALID_ARGUMENT/);
});

test("over-long patterns are rejected before any evaluation", () => {
  assert.throws(() => assertSafeRegex("a".repeat(MAX_REGEX_LENGTH + 1)), /INVALID_ARGUMENT/);
});

test("a pathological but syntactically valid pattern is accepted at validation and bounded downstream", () => {
  // The catastrophe is prevented by the .NET match timeout on the PowerShell
  // side; validation must not pretend to detect it statically.
  assertSafeRegex("(a+)+$");
});

test("find_text rejects an over-long regex at the tool boundary", async () => {
  const { ctx, backend } = ctxWith();
  const env = await envelope(findText.handler(ctx, { regex: "x".repeat(MAX_REGEX_LENGTH + 1) }) as Promise<{ structuredContent: Record<string, unknown> }>);
  assert.equal(env.ok, false);
  assert.equal((env.error as { code: string }).code, "INVALID_ARGUMENT");
  assert.equal(backend.inputCalls.length, 0);
});

test("find_text rejects an invalid regex at the tool boundary", async () => {
  const { ctx } = ctxWith();
  const env = await envelope(findText.handler(ctx, { regex: "(" }) as Promise<{ structuredContent: Record<string, unknown> }>);
  assert.equal(env.ok, false);
  assert.equal((env.error as { code: string }).code, "INVALID_ARGUMENT");
});

test("wait_for_text rejects an invalid regex at the tool boundary", async () => {
  const { ctx } = ctxWith();
  const env = await envelope(waitForText.handler(ctx, { regex: "(", timeout_ms: 500 }) as Promise<{ structuredContent: Record<string, unknown> }>);
  assert.equal((env.error as { code: string }).code, "INVALID_ARGUMENT");
});
