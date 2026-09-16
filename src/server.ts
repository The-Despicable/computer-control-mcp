import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOLS } from "./tools/index.js";
import { errorResult } from "./core/result.js";
import { toToolError } from "./core/errors.js";
import { withMutationLock, logTiming } from "./core/util.js";
import type { Ctx } from "./deps.js";

export function createServer(ctx: Ctx): McpServer {
  const server = new McpServer({ name: "computer-control", version: "1.0.0" });
  for (const tool of TOOLS) {
    server.registerTool(tool.name, {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.shape,
      annotations: { readOnlyHint: tool.readOnly === true },
    }, async (args: Record<string, unknown>) => {
      // Mutations serialize on the mutation lock; reads and waits run concurrently
      // so a 60s wait_for_text never starves observe.
      const run = () => tool.handler(ctx, args);
      const t0 = Date.now();
      try {
        const r = tool.readOnly === true ? await run() : await withMutationLock(run);
        logTiming("tool", { tool: tool.name, ok: true, total_ms: Date.now() - t0 });
        return r;
      } catch (e: unknown) {
        const te = toToolError(e);
        logTiming("tool", { tool: tool.name, ok: false, error: te.code, total_ms: Date.now() - t0 });
        return errorResult(te);
      }
    });
  }
  return server;
}
