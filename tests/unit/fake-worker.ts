import readline from "node:readline";

// Fake PowerShell worker used only by worker.test.ts. Implements the worker
// protocol (###REQ###/###RES### base64 frames) so the Node-side pool logic
// (correlation, crash, restart, timeout, malformed frames) is testable without
// Windows or PowerShell.
function send(o: unknown): void {
  process.stdout.write("###RES###" + Buffer.from(JSON.stringify(o)).toString("base64") + "\n");
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line: string) => {
  if (!line.startsWith("###REQ###")) return;
  let req: { id?: string; script?: string; payload?: unknown };
  try {
    req = JSON.parse(Buffer.from(line.slice(9), "base64").toString("utf8"));
  } catch {
    return;
  }
  const s = req.script ?? "";
  if (s === "hang") return; // never answer -> caller timeout
  if (s === "crash") process.exit(7);
  if (s === "garbage") { process.stdout.write("###RES###@@not-json@@\n"); return; }
  if (s === "fail") { send({ id: req.id, ok: false, error: { code: "INVALID_ARGUMENT", message: "nope" } }); return; }
  send({ id: req.id, ok: true, data: { script: s, payload: req.payload } });
});
