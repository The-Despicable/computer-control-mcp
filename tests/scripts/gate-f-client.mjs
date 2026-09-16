import { spawn } from "node:child_process";
import { dirname, join } from "node:path";

const ROOT = "/home/yaser/keyboard";
const ENTRY = join(ROOT, "dist", "src", "index.js");

class Mcp {
  constructor(env = {}) { this.env = { ...process.env, ...env }; this.seq = 0; this.pending = new Map(); this.proc = null; this.stderr = ""; this.buf = ""; }
  start() {
    this.proc = spawn(process.execPath, [ENTRY], { env: this.env, stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stdout.setEncoding("utf8").on("data", (chunk) => {
      this.buf = (this.buf || "") + chunk;
      let nl;
      while ((nl = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, nl).trim(); this.buf = this.buf.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (typeof msg.id === "number" && this.pending.has(msg.id)) {
            const cb = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (cb) cb(msg);
          }
        } catch { /* partial line */ }
      }
    });
    this.proc.stderr.setEncoding("utf8").on("data", (d) => { this.stderr += d; });
    return this.handshake();
  }
  send(obj) { if (this.proc) this.proc.stdin.write(JSON.stringify(obj) + "\n"); }
  request(method, params, timeoutMs = 60000) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs);
      this.pending.set(id, (m) => { clearTimeout(t); if (m.error) reject(new Error(m.error.message)); else resolve(m.result ?? {}); });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }
  async handshake() {
    const r = await this.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "gate-harness", version: "1.0.0" } });
    this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    return r;
  }
  listTools() { return this.request("tools/list", {}); }
  callTool(name, args, timeoutMs = 90000) {
    return this.request("tools/call", { name, arguments: args ?? {} }, timeoutMs);
  }
  stop() { try { if (this.proc) this.proc.kill(); } catch {} }
}

function parseToolResult(res) {
  const out = { raw: res, image: null, json: null, text: "" };
  for (const c of res?.content ?? []) {
    if (c.type === "image" && typeof c.data === "string") out.image = { type: "image", data: c.data, mimeType: c.mimeType };
    if (c.type === "text" && typeof c.text === "string") {
      out.text = c.text;
      try { out.json = JSON.parse(c.text); } catch { /* not JSON */ }
    }
  }
  return out;
}

export { Mcp, parseToolResult };
