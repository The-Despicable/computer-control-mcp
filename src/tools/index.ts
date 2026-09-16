import type { z } from "zod";
import type { Ctx } from "../deps.js";
import type { ToolResult } from "../core/result.js";
import { observe, windowList, windowFocus } from "./observation.js";
import { findText, findElement } from "./perception.js";
import { click, type as typeTool, keyPress, scroll, drag } from "./input.js";
import { wait, waitForText, waitForChange } from "./wait.js";
import { readText } from "./read.js";

export interface ToolDef {
  name: string; title: string; description: string;
  shape: Record<string, z.ZodTypeAny>;
  readOnly?: boolean;
  handler: (ctx: Ctx, args: unknown) => Promise<ToolResult>;
}

export const TOOLS: ToolDef[] = [
  observe, windowList, windowFocus, findText, findElement,
  click, typeTool, keyPress, scroll, drag, readText,
  wait, waitForText, waitForChange,
];
