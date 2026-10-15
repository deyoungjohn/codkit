/**
 * Run kit tools in a Claude agent loop (Anthropic SDK tool runner).
 * Import from `@iamyoungjohn-kit/mcp/claude`.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { callTool, type AnyKitTool } from "./tool.js";

export const DEFAULT_MODEL = "claude-opus-5-5";

/** Kit tools → tool-runner tools. Errors become `is_error` tool results the model can react to. */
export function toClaudeTools(tools: AnyKitTool[]) {
  return tools.map((tool) =>
    betaZodTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.input,
      run: async (input) => {
        const res = await callTool(tool, input);
        if (!res.ok) throw new Error(res.error);
        return res.text;
      },
    }),
  );
}

export type AgentEvent =
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "turn"; stopReason: string | null; usage: { input_tokens: number; output_tokens: number } };

export interface RunAgentOptions {
  tools: AnyKitTool[];
  /** The task. Pass `messages` instead to continue a conversation. */
  prompt?: string;
  messages?: Anthropic.Beta.BetaMessageParam[];
  system?: string;
  client?: Anthropic;
  model?: string;
  /** Default `high` — agentic tool use benefits from it. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
  /** Cap on model ↔ tool round trips. Default 20. */
  maxIterations?: number;
  /**
   * Server-side refusal fallback (on by default): if the model declines, the API
   * reroutes the same request to a suitable model. Set false to disable.
   */
  fallbacks?: boolean;
  /** Reasoning trace for the dashboard: summarized thinking, text and tool calls, per turn. */
  onEvent?: (e: AgentEvent) => void;
  signal?: AbortSignal;
}

export interface RunAgentResult {
  message: Anthropic.Beta.BetaMessage;
  /** Final text answer (concatenated text blocks). */
  text: string;
  stopReason: string | null;
  turns: number;
}

/**
 * Agentic loop: Claude calls the tools until it's done. Uses adaptive thinking
 * with summarized display so the reasoning can be shown in a demo UI.
 */
export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const client = opts.client ?? new Anthropic();
  const messages = opts.messages ?? [{ role: "user" as const, content: opts.prompt ?? "" }];
  if (!opts.messages && !opts.prompt) throw new Error("runAgent: pass prompt or messages");

  const runner = client.beta.messages.toolRunner(
    {
      model: opts.model ?? DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? 16000,
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: opts.effort ?? "high" },
      max_iterations: opts.maxIterations ?? 20,
      tools: toClaudeTools(opts.tools),
      messages,
      ...(opts.system && { system: opts.system }),
      ...(opts.fallbacks !== false && { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
    },
    opts.signal ? { signal: opts.signal } : undefined,
  );

  let turns = 0;
  for await (const message of runner) {
    turns++;
    for (const block of message.content) {
      if (block.type === "thinking" && block.thinking) opts.onEvent?.({ type: "thinking", text: block.thinking });
      else if (block.type === "text") opts.onEvent?.({ type: "text", text: block.text });
      else if (block.type === "tool_use") opts.onEvent?.({ type: "tool_use", id: block.id, name: block.name, input: block.input });
    }
    opts.onEvent?.({
      type: "turn",
      stopReason: message.stop_reason,
      usage: { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens },
    });
  }
  const message = await runner.done();
  const text = message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return { message, text, stopReason: message.stop_reason, turns };
}
