import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ToolError, normalizePsCode, toToolError } from "../core/errors.js";
import { log } from "../core/util.js";
import { collectOcrMatches, type OcrLine } from "../core/ocr.js";
import { probeCapabilities, type CapabilityReport } from "../core/capability.js";
import { PsPool } from "./worker.js";
import type { Backend, CaptureRequest, CaptureResult, CurrentUiState, InputRequest, InputResult, PerceiveOutcome, PerceiveRequest, WindowsResult } from "../deps.js";

const __dirname = dirname(fileURLToPath(import.meta.url)); // UNC-safe (\\wsl.localhost, \\server\share)
const ASSETS = join(__dirname, "scripts");
const PS_EXE = process.env.COMPUTER_CONTROL_POWERSHELL || "powershell.exe";
const MARKER = "###MCP###";

export const HELPERS = ["_io.ps1", "_win32.ps1", "_state.ps1", "state.ps1", "windows.ps1",
  "capture.ps1", "focus.ps1", "perception.ps1", "input.ps1", "ocr.ps1", "worker.ps1"];

interface PsEnvelopeOk<T> { ok: true; data: T }

function isPsOk<T>(v: unknown): v is PsEnvelopeOk<T> {
  if (typeof v !== "object" || v === null) return false;
  if (!("ok" in v) || v.ok !== true) return false;
  if (!("data" in v) || typeof v.data === "undefined") return false;
  return true;
}

function psErrorOf(v: unknown): { code?: string; message?: string; data?: unknown } | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  if (!("error" in v)) return undefined;
  const e: unknown = v.error;
  if (typeof e !== "object" || e === null) return undefined;
  const out: { code?: string; message?: string; data?: unknown } = {};
  if ("code" in e && typeof e.code === "string") out.code = e.code;
  if ("message" in e && typeof e.message === "string") out.message = e.message;
  if ("data" in e) out.data = e.data;
  return out;
}

/**
 * Spawn-per-call fallback. Used when the persistent worker is unavailable or
 * explicitly disabled. Dispatch-phase tagging: once the request bytes are
 * written, a subsequent failure is potentially post-dispatch (UNCERTAIN).
 */
export function psRun<T>(script: string, req: unknown, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const scriptPath = join(ASSETS, script);
    if (!existsSync(scriptPath))
      return reject(new ToolError("BACKEND_ERROR", `PowerShell helper missing: ${scriptPath} (run: npm run build)`, { script }));
    const child = spawn(PS_EXE,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      { cwd: process.platform === "win32" ? (process.env.SystemRoot || "C:\\") : undefined, windowsHide: true, env: process.env });
    let out = "", err = "", settled = false, dispatched = false;
    const settle = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
    const timer = setTimeout(() => settle(() => {
      child.kill();
      const e = new ToolError("BACKEND_ERROR", `${script} timed out after ${timeoutMs}ms`);
      e.dispatch = dispatched ? "post" : "pre";
      reject(e);
    }), timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (d: string) => { out += d; });
    child.stderr.setEncoding("utf8").on("data", (d: string) => {
      err += d; if (err.length > 16000) err = err.slice(-16000);
      if (process.env.COMPUTER_CONTROL_LOG === "debug") log("debug", `[ps:${script}] ${d.trimEnd()}`);
    });
    child.on("error", (e: Error) => settle(() =>
      reject(new ToolError("BACKEND_ERROR", `failed to spawn ${PS_EXE}: ${e.message}`,
        undefined, "is this running on Windows with PowerShell 5.1 available?"))));
    child.on("close", (code: number | null) => settle(() => {
      const idx = out.indexOf(MARKER);
      if (idx < 0) {
        const e = new ToolError("BACKEND_ERROR", `${script} produced no result (exit=${code})`, { stderr_tail: err.slice(-2000) });
        e.dispatch = dispatched ? "post" : "pre";
        return reject(e);
      }
      let json: unknown;
      try {
        json = JSON.parse(Buffer.from(out.slice(idx + MARKER.length).trim(), "base64").toString("utf8"));
      } catch {
        const e = new ToolError("BACKEND_ERROR", `${script}: undecodable result payload`,
          { stdout_head: out.slice(0, 300).replace(MARKER, "<M>"), stderr_tail: err.slice(-1000) });
        e.dispatch = dispatched ? "post" : "pre";
        return reject(e);
      }
      if (!isPsOk<T>(json)) {
        const raw = psErrorOf(json);
        const code2 = normalizePsCode(String(raw?.code ?? "BACKEND_ERROR"));
        return reject(new ToolError(code2, String(raw?.message ?? "backend error"), raw?.data));
      }
      resolve(json.data);
    }));
    const payload = Buffer.from(JSON.stringify(req ?? {}), "utf8").toString("base64");
    child.stdin.on("error", () => {}); // tolerate EPIPE if the script dies early
    child.stdin.write(payload + "\n", () => { dispatched = true; });
    child.stdin.end();
  });
}

type PsMode = "worker" | "spawn" | "auto";

function resolveMode(): PsMode {
  const raw = (process.env.COMPUTER_CONTROL_PS_MODE || "auto").toLowerCase();
  return raw === "worker" || raw === "spawn" ? raw : "auto";
}

function textPredicate(req: PerceiveRequest): (t: string) => boolean {
  const needle = (req.text ?? "").toLowerCase();
  return (t: string) => needle.length > 0 && t.toLowerCase().includes(needle);
}

export class PowershellBackend implements Backend {
  private pool?: PsPool;
  private preferSpawn = false;
  private readonly mode: PsMode;
  private capabilityReport?: CapabilityReport;
  private ocrMaxDimensionCache?: number;

  constructor(mode: PsMode = resolveMode()) {
    this.mode = mode;
    if (mode !== "spawn") {
      this.pool = new PsPool({
        exe: PS_EXE,
        args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(ASSETS, "worker.ps1")],
        size: Math.max(1, Number(process.env.COMPUTER_CONTROL_PS_POOL ?? 2)),
        env: process.env,
        requestTimeoutMs: 45000,
        onStderr: (d) => { if (process.env.COMPUTER_CONTROL_LOG === "debug") log("debug", `[ps-worker] ${d.trimEnd()}`); },
      });
    }
  }

  selfCheck() {
    const missing = HELPERS.filter(h => !existsSync(join(ASSETS, h)));
    if (missing.length)
      throw new ToolError("BACKEND_ERROR", `PowerShell helpers not installed: ${missing.join(", ")} (run: npm run build)`);
  }

  /** Startup capability probe (cached). Never throws on a non-Windows host. */
  async probeCapabilities(): Promise<CapabilityReport> {
    if (this.capabilityReport) return this.capabilityReport;
    this.capabilityReport = await probeCapabilities({
      platform: process.platform,
      powershellExe: PS_EXE,
      helperDir: ASSETS,
      helpers: HELPERS,
      exists: (p) => existsSync(join(ASSETS, p)),
      runPowerShell: (args, timeoutMs) => new Promise((resolve) => {
        execFile(PS_EXE, args, { windowsHide: true, timeout: timeoutMs, encoding: "utf8" }, (error, stdout, stderr) => {
          resolve({ code: error ? 1 : 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
        });
      }),
      ocrProbe: process.platform === "win32" ? async () => {
        const out = await new Promise<string>((resolve) => {
          execFile(PS_EXE, ["-NoProfile", "-NonInteractive", "-Command",
            "try { Add-Type -AssemblyName System.Runtime.WindowsRuntime; $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]; '1' } catch { '0' }"],
            { windowsHide: true, timeout: 10000, encoding: "utf8" }, (_e, so) => resolve(String(so ?? "")));
        });
        return out.trim() === "1";
      } : undefined,
    });
    return this.capabilityReport;
  }

  capabilities(): CapabilityReport | undefined { return this.capabilityReport; }

  private async send<T>(script: string, payload: unknown, timeoutMs: number): Promise<T> {
    if (this.pool && !this.preferSpawn) {
      try {
        return await this.pool.run<T>(script, payload, timeoutMs);
      } catch (e) {
        const te = toToolError(e);
        const workerDown = te.dispatch === "pre" &&
          /worker (is not running|exited|spawn error)|no PowerShell workers|pool is closed/i.test(te.message);
        if (this.mode === "worker") throw e;
        if (workerDown) {
          this.preferSpawn = true;
          log("error", "[ps] persistent worker unavailable; falling back to spawn-per-call", { reason: te.message });
        } else {
          throw e;
        }
      }
    }
    return psRun<T>(script, payload, timeoutMs);
  }

  private async ocrTile(tile: { x: number; y: number; w: number; h: number }, regex?: string): Promise<OcrLine[]> {
    const payload = regex
      ? { ...tile, regex, regex_timeout_ms: 250 }
      : tile;
    const r = await this.send<{ lines: OcrLine[] }>("ocr.ps1", payload, 30000);
    return r.lines ?? [];
  }

  capture(req: CaptureRequest): Promise<CaptureResult> { return this.send<CaptureResult>("capture.ps1", req, 30000); }
  state(): Promise<CurrentUiState> { return this.send<CurrentUiState>("state.ps1", {}, 15000); }
  windows(): Promise<WindowsResult> { return this.send<WindowsResult>("windows.ps1", {}, 20000); }
  focus(hwnd: number): Promise<CurrentUiState> { return this.send<CurrentUiState>("focus.ps1", { hwnd }, 15000); }
  input(req: InputRequest): Promise<InputResult> { return this.send<InputResult>("input.ps1", req, 20000); }

  async perceive(req: PerceiveRequest): Promise<PerceiveOutcome> {
    // perception.ps1 performs UIA only; OCR is tiled and combined here in TS.
    const uia = await this.send<PerceiveOutcome & { ocr_max_dimension?: number }>("perception.ps1", req, 45000);
    if (typeof uia.ocr_max_dimension === "number" && uia.ocr_max_dimension >= 1) this.ocrMaxDimensionCache = uia.ocr_max_dimension;

    const engine = req.engine ?? "auto";
    if (req.mode !== "text" || engine === "uia") return uia;
    if (!uia.ocr_available) {
      return engine === "ocr" ? { ...uia, matches: [], engines_used: ["uia"] } : uia;
    }
    if (engine === "auto" && uia.matches.length > 0) return uia;

    const region = req.scope === "foreground" && uia.foreground ? uia.foreground.bounds : uia.virtual_screen;
    const maxDim = this.ocrMaxDimensionCache ?? 4096;
    const useRegex = typeof req.regex === "string" && req.regex.length > 0;
    const combined = await collectOcrMatches({
      region,
      maxDim,
      maxMatches: req.limit ?? 10,
      ocrAvailable: true,
      test: useRegex ? () => true : textPredicate(req),
      runTile: (tile) => this.ocrTile(tile, useRegex ? req.regex : undefined),
      onTileError: (tile, err) => log("error", "[ocr] tile failed; content omitted", { tile, error: err instanceof Error ? err.message : String(err) }),
    });

    return {
      ...uia,
      matches: engine === "ocr" ? combined.matches : [...uia.matches, ...combined.matches],
      engines_used: engine === "ocr" ? ["ocr"] : Array.from(new Set([...uia.engines_used, "ocr"])),
      truncated: uia.truncated || combined.truncated,
      ocr_tiles_total: combined.tiles_total,
      ocr_tiles_failed: combined.tiles_failed,
    } as PerceiveOutcome;
  }

  async close(): Promise<void> { await this.pool?.close(); }
}
