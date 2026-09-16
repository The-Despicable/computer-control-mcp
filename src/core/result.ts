import { ToolError } from "./errors.js";

export interface ToolSuccess { ok: true; tool: string; data: Record<string, unknown> }

export interface ToolImageContent { type: "image"; data: string; mimeType: string }
export interface ToolTextContent { type: "text"; text: string }
export type ToolContent = ToolImageContent | ToolTextContent;

export interface ToolOkResult {
  [key: string]: unknown;
  content: ToolContent[];
  structuredContent: Record<string, unknown>;
}

export interface ToolErrResult {
  [key: string]: unknown;
  content: [ToolTextContent];
  structuredContent: {
    ok: false; tool: undefined;
    error: { code: string; message: string; details: unknown; hint: unknown };
    status?: string;
    mutation_id?: string;
    operation?: string;
    reason?: string;
  };
  isError: true;
}

export type ToolResult = ToolOkResult | ToolErrResult;

export function okResult(tool: string, data: Record<string, unknown>, image?: { data: string; mimeType: string }): ToolOkResult {
  const envelope: Record<string, unknown> = { ok: true, tool, ...data };
  const content: ToolContent[] = [];
  // The screenshot is delivered as native MCP image content — never as a filesystem path.
  if (image) content.push({ type: "image", data: image.data, mimeType: image.mimeType });
  content.push({ type: "text", text: JSON.stringify(envelope) });
  return { content, structuredContent: envelope };
}

export function errorResult(e: ToolError): ToolErrResult {
  const receipt = e.receipt;
  const envelope = {
    ok: false as const,
    tool: undefined,
    error: { code: e.code, message: e.message.replace(/^\[[A-Z_]+\]\s*/, ""), details: e.details ?? null, hint: e.hint ?? null },
    // Mutation outcome semantics are surfaced explicitly; absent for read-only tools.
    ...(receipt
      ? { status: receipt.status, mutation_id: receipt.mutation_id, operation: receipt.operation, reason: receipt.reason ?? e.code }
      : {}),
  };
  const text = JSON.stringify(envelope);
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: envelope,
    isError: true as const,
  };
}
