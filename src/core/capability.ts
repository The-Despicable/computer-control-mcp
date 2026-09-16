/**
 * Startup capability probe. Determines, without side effects, whether the
 * Windows backend can actually run in this environment and reports the truth
 * instead of failing only when the first tool is called.
 *
 * It never crashes the process on a non-Windows host: the MCP is allowed to run
 * on Linux/WSL for development/build/tests. Unsupported environments are
 * reported as `backend_ready: false` and tools continue to return structured
 * BACKEND_ERROR.
 */

export interface PowerShellProbeResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface CapabilityProbeInput {
  platform: NodeJS.Platform;
  powershellExe: string;
  helperDir: string;
  helpers: string[];
  exists: (path: string) => boolean;
  runPowerShell: (args: string[], timeoutMs: number) => Promise<PowerShellProbeResult>;
  /** Optional live OCR check. Omit when it cannot be determined cheaply. */
  ocrProbe?: () => Promise<boolean>;
}

export interface CapabilityReport {
  platform: string;
  windows: boolean;
  powershell: { exe: string; available: boolean; version: string | null; version_supported: boolean | null };
  helpers: { dir: string; present: boolean; missing: string[] };
  ocr: { available: boolean | null; checked: boolean };
  backend_ready: boolean;
  detail: string;
}

const PS_VERSION_PROBE = "$PSVersionTable.PSVersion.ToString()";

function parseVersion(raw: string): { major: number; minor: number; text: string } | null {
  const m = /(\d+)\.(\d+)/.exec(raw.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), text: m[0] };
}

export async function probeCapabilities(input: CapabilityProbeInput): Promise<CapabilityReport> {
  const windows = input.platform === "win32";
  const missing = input.helpers.filter((h) => !input.exists(h));
  const helpers = { dir: input.helperDir, present: missing.length === 0, missing };

  let psAvailable = false;
  let psVersion: string | null = null;
  let psSupported: boolean | null = null;

  if (windows) {
    try {
      const r = await input.runPowerShell(["-NoProfile", "-NonInteractive", "-Command", PS_VERSION_PROBE], 10000);
      const raw = (r.stdout || "").trim();
      const parsed = parseVersion(raw);
      if (r.code === 0 && parsed) {
        psAvailable = true;
        psVersion = parsed.text;
        // Windows PowerShell 5.1 is the supported host; pwsh 7 lacks WinRT OCR.
        psSupported = parsed.major === 5 && parsed.minor >= 1;
      } else {
        psAvailable = false;
        psSupported = false;
      }
    } catch {
      psAvailable = false;
      psSupported = false;
    }
  } else {
    psSupported = false;
  }

  let ocrAvailable: boolean | null = null;
  let ocrChecked = false;
  if (input.ocrProbe) {
    try {
      ocrAvailable = await input.ocrProbe();
    } catch {
      ocrAvailable = false;
    }
    ocrChecked = true;
  }

  const backendReady = windows && psAvailable && psSupported === true && helpers.present;

  const detail = !windows
    ? `platform=${input.platform}: Windows backend unavailable (non-Windows host); tools will return BACKEND_ERROR`
    : !psAvailable
      ? `Windows detected but ${input.powershellExe} is not runnable`
      : !psSupported
        ? `PowerShell ${psVersion ?? "unknown"} detected; Windows PowerShell 5.1 is required (pwsh 7 lacks WinRT OCR)`
        : !helpers.present
          ? `PowerShell helpers missing: ${missing.join(", ")} (run npm run build)`
          : `backend ready (PowerShell ${psVersion}, OCR ${ocrAvailable === null ? "unchecked" : ocrAvailable ? "available" : "unavailable"})`;

  return {
    platform: input.platform,
    windows,
    powershell: { exe: input.powershellExe, available: psAvailable, version: psVersion, version_supported: psSupported },
    helpers,
    ocr: { available: ocrAvailable, checked: ocrChecked },
    backend_ready: backendReady,
    detail,
  };
}
