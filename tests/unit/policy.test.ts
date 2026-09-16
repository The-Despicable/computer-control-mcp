import test from "node:test";
import assert from "node:assert/strict";
import { Policy } from "../../src/core/policy.js";

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    const v = env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { fn(); } finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k] as string;
    }
  }
}

test("default policy is observe-only", () => {
  withEnv({ COMPUTER_CONTROL_INPUT_ENABLED: undefined, COMPUTER_CONTROL_ALLOWED_PIDS: undefined, COMPUTER_CONTROL_ALLOWED_WINDOW_TITLES: undefined }, () => {
    const p = Policy.load();
    assert.equal(p.inputEnabled, false);
    assert.equal(p.allowedPids, null);
    assert.throws(() => p.assertInputEnabled(), /POLICY_DENIED/);
  });
});

test("input enable flag parsing", () => {
  withEnv({ COMPUTER_CONTROL_INPUT_ENABLED: "true" }, () => {
    assert.equal(Policy.load().inputEnabled, true);
  });
  withEnv({ COMPUTER_CONTROL_INPUT_ENABLED: "0" }, () => {
    assert.equal(Policy.load().inputEnabled, false);
  });
});

test("PID allowlist refuses non-listed foreground", () => {
  withEnv({ COMPUTER_CONTROL_INPUT_ENABLED: "true", COMPUTER_CONTROL_ALLOWED_PIDS: "111,222" }, () => {
    const p = Policy.load();
    p.assertWindowAllowed({ hwnd: 1, pid: 111, process: "a", title: "A", bounds: { x: 0, y: 0, w: 1, h: 1 } });
    assert.throws(() => p.assertWindowAllowed({ hwnd: 2, pid: 999, process: "b", title: "B", bounds: { x: 0, y: 0, w: 1, h: 1 } }), /POLICY_DENIED/);
  });
});

test("title allowlist is case-insensitive substring", () => {
  withEnv({ COMPUTER_CONTROL_INPUT_ENABLED: "true", COMPUTER_CONTROL_ALLOWED_WINDOW_TITLES: "notepad" }, () => {
    const p = Policy.load();
    p.assertWindowAllowed({ hwnd: 1, pid: 5, process: "n", title: "Untitled - Notepad", bounds: { x: 0, y: 0, w: 1, h: 1 } });
    assert.throws(() => p.assertWindowAllowed({ hwnd: 1, pid: 5, process: "b", title: "Bank Vault", bounds: { x: 0, y: 0, w: 1, h: 1 } }), /POLICY_DENIED/);
  });
});

test("null foreground passes allowlist (nothing to bind)", () => {
  withEnv({ COMPUTER_CONTROL_INPUT_ENABLED: "true", COMPUTER_CONTROL_ALLOWED_PIDS: "111" }, () => {
    Policy.load().assertWindowAllowed(null);
  });
});
