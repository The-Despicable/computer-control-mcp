import test from "node:test";
import assert from "node:assert/strict";
import { probeCapabilities, type CapabilityProbeInput } from "../../src/core/capability.js";

function input(overrides: Partial<CapabilityProbeInput> = {}): CapabilityProbeInput {
  return {
    platform: "win32",
    powershellExe: "powershell.exe",
    helperDir: "C:/x/scripts",
    helpers: ["_io.ps1", "input.ps1"],
    exists: () => true,
    runPowerShell: async () => ({ code: 0, stdout: "5.1.19041.1", stderr: "" }),
    ...overrides,
  };
}

test("Windows + PowerShell 5.1 + helpers => backend ready", async () => {
  const r = await probeCapabilities(input({ ocrProbe: async () => true }));
  assert.equal(r.windows, true);
  assert.equal(r.powershell.available, true);
  assert.equal(r.powershell.version, "5.1");
  assert.equal(r.powershell.version_supported, true);
  assert.equal(r.helpers.present, true);
  assert.equal(r.ocr.available, true);
  assert.equal(r.backend_ready, true);
});

test("missing PowerShell => not ready, no crash", async () => {
  const r = await probeCapabilities(input({ runPowerShell: async () => { throw new Error("ENOENT"); } }));
  assert.equal(r.powershell.available, false);
  assert.equal(r.backend_ready, false);
});

test("unsupported PowerShell (pwsh 7) => not ready", async () => {
  const r = await probeCapabilities(input({ runPowerShell: async () => ({ code: 0, stdout: "7.4.1", stderr: "" }) }));
  assert.equal(r.powershell.available, true);
  assert.equal(r.powershell.version_supported, false);
  assert.equal(r.backend_ready, false);
  assert.match(r.detail, /5\.1/);
});

test("missing helper => not ready", async () => {
  const r = await probeCapabilities(input({ exists: (p) => !p.endsWith("input.ps1") }));
  assert.equal(r.helpers.present, false);
  assert.deepEqual(r.helpers.missing, ["input.ps1"]);
  assert.equal(r.backend_ready, false);
});

test("Linux/WSL => Windows backend unavailable but no crash", async () => {
  const r = await probeCapabilities(input({ platform: "linux" }));
  assert.equal(r.windows, false);
  assert.equal(r.backend_ready, false);
  assert.match(r.detail, /non-Windows/);
});

test("OCR availability is reported when checked, null when not", async () => {
  const checked = await probeCapabilities(input({ ocrProbe: async () => false }));
  assert.equal(checked.ocr.checked, true);
  assert.equal(checked.ocr.available, false);
  const unchecked = await probeCapabilities(input());
  assert.equal(unchecked.ocr.checked, false);
  assert.equal(unchecked.ocr.available, null);
});
