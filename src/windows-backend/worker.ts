import { spawn as nodeSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { ToolError, normalizePsCode } from "../core/errors.js";
import { log } from "../core/util.js";

/**
 * Persistent PowerShell execution layer.
 *
 * One long-lived `worker.ps1` process receives length-prefixed request lines and
 * answers with correlated response lines, so the expensive `Add-Type` build and
 * PowerShell startup happen once instead of per call.
 *
 *   request : ###REQ###<base64(JSON { id, script, payload })>\n
 *   response: ###RES###<base64(JSON { id, ok, data } | { id, ok:false, error })>\n
 *
 * The Node side owns request ids, response correlation, timeouts, crash
 * detection, restart and (crucially) dispatch-phase tagging used by mutation
 * receipts: any failure after a request has been written is potentially
 * post-dispatch and therefore UNCERTAIN.
 */

export const REQ_MARK = "###REQ###";
export const RES_MARK = "###RES###";

export interface WorkerChild extends EventEmitter {
  stdin: (EventEmitter & { write(data: string, cb?: (err?: Error) => void): boolean; end(): void }) | null;
  stdout: (EventEmitter & { setEncoding?(enc: string): void }) | null;
  stderr: (EventEmitter & { setEncoding?(enc: string): void }) | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  pid?: number;
}

export type SpawnImpl = (exe: string, args: string[], opts: Record<string, unknown>) => WorkerChild;

export interface PsWorkerOptions {
  exe: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  spawnImpl?: SpawnImpl;
  onExit?: (worker: PsWorker) => void;
  onStderr?: (chunk: string) => void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  script: string;
  dispatched: boolean;
}

export class PsWorker {
  private child: WorkerChild | null = null;
  private buffer = "";
  private seq = 0;
  private pending = new Map<string, Pending>();
  private alive = false;

  constructor(private readonly opts: PsWorkerOptions) {}

  get healthy(): boolean { return this.alive; }
  get pendingCount(): number { return this.pending.size; }

  start(): void {
    if (this.child) return;
    const spawnImpl = this.opts.spawnImpl ?? (nodeSpawn as unknown as SpawnImpl);
    const child = spawnImpl(this.opts.exe, this.opts.args, {
      cwd: this.opts.cwd,
      env: this.opts.env ?? process.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    if (child.stdout && typeof child.stdout.setEncoding === "function") child.stdout.setEncoding("utf8");
    if (child.stderr && typeof child.stderr.setEncoding === "function") child.stderr.setEncoding("utf8");
    child.stdout?.on("data", (d: string | Buffer) => this.onData(typeof d === "string" ? d : d.toString("utf8")));
    child.stderr?.on("data", (d: string | Buffer) => this.opts.onStderr?.(typeof d === "string" ? d : d.toString("utf8")));
    child.stdin?.on("error", () => { /* tolerate EPIPE / write-after-end while shutting down */ });
    child.on("error", (e: Error) => this.finalize("pre", "worker spawn error", e.message));
    child.on("exit", (code: number | null) => this.finalize("post", `PowerShell worker exited (code=${code})`, "worker_exited_mid_request"));
    this.alive = true;
  }

  private makeError(code: string, message: string, dispatch: "pre" | "post", script: string, reason?: string): ToolError {
    const e = new ToolError(normalizePsCode(code), message, reason ? { reason, script } : { script });
    e.dispatch = dispatch;
    return e;
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, "");
      this.buffer = this.buffer.slice(idx + 1);
      if (line) this.onLine(line);
    }
  }

  private onLine(line: string): void {
    if (!line.startsWith(RES_MARK)) return;
    let msg: { id?: string; ok?: boolean; data?: unknown; error?: { code?: string; message?: string; data?: unknown } };
    try {
      msg = JSON.parse(Buffer.from(line.slice(RES_MARK.length).trim(), "base64").toString("utf8"));
    } catch {
      log("error", "[ps-worker] undecodable response frame");
      return;
    }
    const p = msg.id ? this.pending.get(msg.id) : undefined;
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(msg.id as string);
    if (msg.ok) {
      p.resolve(msg.data);
    } else {
      const raw = msg.error ?? {};
      p.reject(this.makeError(String(raw.code ?? "BACKEND_ERROR"), String(raw.message ?? "backend error"), "pre", p.script));
    }
  }

  private failAll(dispatch: "pre" | "post", message: string, reason?: string): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      this.pending.delete(id);
      // A request only counts as dispatched once its bytes were written.
      p.reject(this.makeError("BACKEND_ERROR", message, p.dispatched ? dispatch : "pre", p.script, reason));
    }
  }

  private finalize(dispatch: "pre" | "post", message: string, reason?: string): void {
    if (!this.alive && !this.child) return; // already finalized
    this.alive = false;
    this.child = null;
    this.failAll(dispatch, message, reason);
    this.opts.onExit?.(this);
  }

  run<T>(script: string, payload: unknown, timeoutMs = this.opts.requestTimeoutMs ?? 30000): Promise<T> {
    if (!this.alive || !this.child || !this.child.stdin) {
      return Promise.reject(this.makeError("BACKEND_ERROR", "PowerShell worker is not running", "pre", script));
    }
    const id = `ps-${this.child.pid ?? "x"}-${++this.seq}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // Mark dead FIRST so the pool cannot hand this worker to another caller
        // before its 'exit' event arrives, then kill it so it cannot answer late.
        this.alive = false;
        this.kill();
        reject(this.makeError("BACKEND_ERROR", `${script} timed out after ${timeoutMs}ms`, "post", script, "transport_timeout_after_dispatch"));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer, script, dispatched: false });
      const frame = REQ_MARK + Buffer.from(JSON.stringify({ id, script, payload }), "utf8").toString("base64") + "\n";
      try {
        this.child?.stdin?.write(frame, () => {
          const p = this.pending.get(id);
          if (p) p.dispatched = true;
        });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        this.alive = false; // broken stdin -> replace rather than reuse
        this.kill();
        reject(this.makeError("BACKEND_ERROR", `failed to write to PowerShell worker: ${e instanceof Error ? e.message : String(e)}`, "pre", script));
      }
    });
  }

  kill(): void {
    const c = this.child;
    if (c) {
      try { c.stdin?.end(); } catch { /* ignore */ }
      try { c.kill(); } catch { /* ignore */ }
    }
  }
}

export interface PsPoolOptions {
  exe: string;
  args: string[];
  size?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  spawnImpl?: SpawnImpl;
  onStderr?: (chunk: string) => void;
}

interface Waiter { resolve: (w: PsWorker) => void; reject: (e: Error) => void; }

/**
 * A small pool of persistent workers. Reads may run concurrently across
 * workers; mutations are already serialized by the Node mutation lock.
 * A dead worker is replaced automatically (unless the pool is closing).
 */
export class PsPool {
  private workers: PsWorker[] = [];
  private waiters: Waiter[] = [];
  private closing = false;
  private restarts = 0;
  private lastRestartAt = 0;
  private static readonly MAX_BURST_RESTARTS = 5;

  constructor(private readonly opts: PsPoolOptions) {
    const size = Math.max(1, opts.size ?? 2);
    for (let i = 0; i < size; i++) this.spawnOne();
  }

  private spawnOne(): PsWorker {
    const w = new PsWorker({
      exe: this.opts.exe,
      args: this.opts.args,
      cwd: this.opts.cwd,
      env: this.opts.env,
      requestTimeoutMs: this.opts.requestTimeoutMs,
      spawnImpl: this.opts.spawnImpl,
      onStderr: this.opts.onStderr,
      onExit: (dead) => this.onWorkerExit(dead),
    });
    w.start();
    this.workers.push(w);
    return w;
  }

  private onWorkerExit(dead: PsWorker): void {
    this.workers = this.workers.filter(w => w !== dead);
    if (this.closing) {
      // no replacement; wake waiters so callers fail fast
      this.flushWaiters();
      return;
    }
    // Guard against a spawn/exit loop (e.g. PowerShell genuinely unavailable).
    const now = Date.now();
    if (now - this.lastRestartAt < 500) this.restarts += 1; else this.restarts = 0;
    this.lastRestartAt = now;
    if (this.restarts > PsPool.MAX_BURST_RESTARTS) {
      log("error", "[ps-pool] too many worker restarts in a burst; not respawning (caller may fall back)", { restarts: this.restarts });
      this.flushWaiters();
      return;
    }
    const replacement = this.spawnOne();
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve(replacement);
  }

  private flushWaiters(): void {
    const waiters = this.waiters.splice(0);
    for (const w of waiters) w.reject(new ToolError("BACKEND_ERROR", "PowerShell pool is closed"));
  }

  private acquire(): Promise<PsWorker> {
    if (this.closing) return Promise.reject(new ToolError("BACKEND_ERROR", "PowerShell pool is closed"));
    const healthy = this.workers.filter(w => w.healthy);
    if (healthy.length === 0) {
      if (this.workers.length > 0) {
        // all workers are unhealthy but replacements are coming; wait
      } else {
        return Promise.reject(new ToolError("BACKEND_ERROR", "no PowerShell workers available"));
      }
    }
    if (healthy.length > 0) {
      healthy.sort((a, b) => a.pendingCount - b.pendingCount);
      const idle = healthy.find(w => w.pendingCount === 0);
      if (idle) return Promise.resolve(idle);
    }
    return new Promise<PsWorker>((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  async run<T>(script: string, payload: unknown, timeoutMs?: number): Promise<T> {
    const w = await this.acquire();
    try {
      return await w.run<T>(script, payload, timeoutMs);
    } finally {
      const waiter = this.waiters.shift();
      if (waiter) {
        const usable = this.workers.find(x => x.healthy && x.pendingCount === 0);
        if (usable) waiter.resolve(usable);
        else this.waiters.unshift(waiter);
      }
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    this.flushWaiters();
    const workers = this.workers.splice(0);
    for (const w of workers) w.kill();
  }
}
