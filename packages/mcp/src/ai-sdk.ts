/**
 * Kit tools as Vercel AI SDK tools. Import from `@codkit/mcp/ai-sdk` (needs `ai`).
 *
 * ```ts
 * const { text } = await generateText({ model, tools: toAiSdkTools(tools), stopWhen: isStepCount(8), prompt });
 * ```
 *
 * Inputs are validated by each tool's zod schema (by the SDK, then again by `callTool`), a thrown tool
 * error reaches the model as a tool error it can react to, and results are plain JSON (bigints become strings).
 */
import { type ToolSet, tool } from "ai";
import { type AnyKitTool, callTool } from "./tool.js";

export interface AiSdkOptions {
  /** Called with every tool result, e.g. to feed a dashboard. */
  onResult?: (e: { name: string; ok: boolean; output: string }) => void;
}

export function toAiSdkTools(tools: readonly AnyKitTool[], opts: AiSdkOptions = {}): ToolSet {
  return Object.fromEntries(
    tools.map((t) => [
      t.name,
      tool({
        description: t.description,
        inputSchema: t.input,
        ...(t.title && { title: t.title }),
        execute: async (input: unknown, { abortSignal }: { abortSignal?: AbortSignal }) => {
          const res = await callTool(t, input, abortSignal ? { signal: abortSignal } : {});
          opts.onResult?.({ name: t.name, ok: res.ok, output: res.text });
          if (!res.ok) throw new Error(res.error);
          return plain(res.value);
        },
      }),
    ]),
  ) as ToolSet;
}

/** JSON-safe copy of a tool result. */
function plain(value: unknown): unknown {
  if (value === undefined) return "ok";
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}
