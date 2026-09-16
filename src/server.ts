import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOLS } from "./tools/index.js";
import { errorResult } from "./core/result.js";
import { toToolError } from "./core/errors.js";
import { withMutationLock } from "./core/util.js";
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
      try { return tool.readOnly === true ? await run() : await withMutationLock(run); }
      catch (e: unknown) { return errorResult(toToolError(e)); }
    });
  }
  return server;
}
