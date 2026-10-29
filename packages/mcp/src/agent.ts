/**
 * Run kit tools in an agent loop on any OpenAI-compatible Chat Completions API:
 * Gemini, Groq, NVIDIA NIM, OpenRouter, AgentRouter, or your own base URL.
 * Plain `fetch`, no SDK. Import from `@codkit/mcp/agent`.
 */
import { z } from "zod";
import { callTool, type AnyKitTool } from "./tool.js";

export interface LlmProvider {
  /** Label for traces and errors, e.g. `groq`. */
  name: string;
  /** Up to and including the version segment; `/chat/completions` is appended. */
  baseUrl: string;
  apiKey?: string;
  model: string;
  headers?: Record<string, string>;
}

export interface ProviderPreset {
  baseUrl: string;
  /** Env var holding the API key. */
  keyEnv: string;
  /**
   * Default model; a comma-separated list means "try these in order". Free-tier
   * catalogues change often — override with `LLM_MODEL` / `<NAME>_MODEL`.
   */
  model?: string;
  headers?: Record<string, string>;
}

/** Presets, in auto-detect order (most generous free tier with solid tool calling first). */
export const PROVIDERS = {
  groq: { baseUrl: "https://api.groq.com/openai/v1", keyEnv: "GROQ_API_KEY", model: "openai/gpt-oss-120b" },
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", keyEnv: "GEMINI_API_KEY", model: "gemini-3.5-flash,gemini-flash-lite-latest" },
  nvidia: { baseUrl: "https://integrate.api.nvidia.com/v1", keyEnv: "NVIDIA_API_KEY", model: "openai/gpt-oss-120b" },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
    // free models with tool support, tried in order (free slugs churn — check `example:models`)
    model: [
      "dots-studio/dots-3-note-preview:free",
      "nvidia/nemotron-3-ultra-550b-a55b:free",
      "google/gemma-4-31b-it:free",
      "nvidia/nemotron-3-super-120b-a12b:free",
    ].join(","),
    headers: { "X-Title": "codkit" },
  },
  // No default model: the catalogue is account-specific (`pnpm --filter @codkit/mcp example:models`).
  agentrouter: { baseUrl: "https://agentrouter.org/v1", keyEnv: "AGENTROUTER_API_KEY" },
} satisfies Record<string, ProviderPreset>;

export type ProviderName = keyof typeof PROVIDERS;

/**
 * Providers from env, in failover order.
 * - `LLM_PROVIDER=groq,gemini` picks and orders presets; `custom` uses `LLM_BASE_URL` + `LLM_API_KEY`.
 * - Unset: every preset whose key env var is set, in `PROVIDERS` order.
 * - Model: `<NAME>_MODEL` (e.g. `GROQ_MODEL`), else `LLM_MODEL` for the first provider, else the preset default.
 *   A comma-separated model list expands into one failover entry per model.
 */
export function providersFromEnv(env: Record<string, string | undefined> = process.env): LlmProvider[] {
  const names = env.LLM_PROVIDER
    ? env.LLM_PROVIDER.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    : (Object.keys(PROVIDERS) as ProviderName[]).filter((n) => env[PROVIDERS[n].keyEnv]);
  return names.flatMap((name, i): LlmProvider[] => {
    const m = env[`${name.toUpperCase()}_MODEL`] || (i === 0 ? env.LLM_MODEL : undefined);
    if (name === "custom") {
      if (!env.LLM_BASE_URL || !m) throw new Error("LLM_PROVIDER=custom needs LLM_BASE_URL and CUSTOM_MODEL (or LLM_MODEL)");
      return models(m).map((model) => ({ name, baseUrl: env.LLM_BASE_URL!, apiKey: env.LLM_API_KEY, model }));
    }
    const preset: ProviderPreset | undefined = PROVIDERS[name as ProviderName];
    if (!preset) throw new Error(`unknown LLM provider "${name}" (known: ${Object.keys(PROVIDERS).join(", ")}, custom)`);
    const apiKey = env[preset.keyEnv];
    if (!apiKey) throw new Error(`${name}: set ${preset.keyEnv}`);
    const list = models(m || preset.model);
    if (!list.length) throw new Error(`${name}: set ${name.toUpperCase()}_MODEL (or LLM_MODEL)`);
    return list.map((model) => ({ name, baseUrl: preset.baseUrl, apiKey, model, ...(preset.headers && { headers: preset.headers }) }));
  });
}

const models = (s: string | undefined) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);

// ------------------------------------------------------------ wire types

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface ChatResponse {
  model?: string;
  choices?: { finish_reason?: string | null; message?: { content?: string | null; tool_calls?: ToolCall[]; reasoning?: string; reasoning_content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string } | string;
}

/** Kit tools → Chat Completions `tools`. */
export function toOpenAITools(tools: AnyKitTool[]) {
  return tools.map((tool) => {
    const { $schema: _, ...parameters } = z.toJSONSchema(tool.input, { target: "draft-7", io: "input" }) as Record<string, unknown>;
    return { type: "function" as const, function: { name: tool.name, description: tool.description, parameters } };
  });
}

// ------------------------------------------------------------ loop

export type AgentEvent =
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | {
      type: "turn";
      stopReason: string | null;
      usage: { input_tokens: number; output_tokens: number };
      provider: string;
      model: string;
    }
  /** `from` / `to` are `provider/model`. */
  | { type: "failover"; from: string; to: string; error: string };

export interface RunAgentOptions {
  tools: AnyKitTool[];
  /** The task. Pass `messages` instead to continue a conversation. */
  prompt?: string;
  messages?: ChatMessage[];
  system?: string;
  /** One provider or a failover list. Default: `providersFromEnv()`. */
  providers?: LlmProvider | LlmProvider[];
  maxTokens?: number;
  temperature?: number;
  /** Cap on model ↔ tool round trips. Default 20. */
  maxIterations?: number;
  /** Retries per provider on 429 / 5xx / network errors before failing over. Default 2. */
  retries?: number;
  /** Cap on a single backoff wait (ms). Default 20 000. */
  maxBackoffMs?: number;
  /** Give up on one model request after this long (ms) and fail over without retrying. Default 60 000. */
  requestTimeoutMs?: number;
  onEvent?: (e: AgentEvent) => void;
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
}

export interface RunAgentResult {
  /** Full history including the final assistant message — pass back as `messages` to continue. */
  messages: ChatMessage[];
  /** Final text answer. */
  text: string;
  /** `stop`, `length`, `max_iterations`, … */
  stopReason: string | null;
  turns: number;
  provider: string;
  model: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

/** The provider accepted the connection but never answered: retrying the same one rarely helps. */
class RequestTimeout extends Error {}

const retryable = (e: unknown) => !(e instanceof RequestTimeout) && (!(e instanceof HttpError) || e.status === 429 || e.status >= 500);

/** Agentic loop: the model calls tools until it answers without one. */
export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  if (!opts.messages && !opts.prompt) throw new Error("runAgent: pass prompt or messages");
  const providers = [opts.providers ?? providersFromEnv()].flat();
  if (!providers.length) {
    throw new Error(`runAgent: no LLM provider configured — set one of ${Object.values(PROVIDERS).map((p) => p.keyEnv).join(", ")}`);
  }
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const byName = new Map(opts.tools.map((t) => [t.name, t]));
  const tools = toOpenAITools(opts.tools);
  const messages: ChatMessage[] = opts.messages
    ? [...opts.messages]
    : [...(opts.system ? [{ role: "system" as const, content: opts.system }] : []), { role: "user" as const, content: opts.prompt! }];

  let active = 0; // sticky: once we fail over, stay on the provider that works
  const complete = async (): Promise<{ res: ChatResponse; provider: LlmProvider }> => {
    let lastErr: unknown;
    for (let p = active; p < providers.length; p++) {
      const provider = providers[p]!;
      for (let attempt = 0; attempt <= (opts.retries ?? 2); attempt++) {
        try {
          const res = await post(provider);
          if (p !== active) active = p;
          return { res, provider };
        } catch (e) {
          lastErr = e;
          if (opts.signal?.aborted || !retryable(e) || attempt === (opts.retries ?? 2)) break;
          const wait = Math.min((e as HttpError).retryAfterMs ?? 1000 * 2 ** attempt, opts.maxBackoffMs ?? 20_000);
          await sleep(wait, opts.signal);
        }
      }
      if (opts.signal?.aborted) break;
      const next = providers[p + 1];
      if (next) opts.onEvent?.({ type: "failover", from: label(provider), to: label(next), error: msg(lastErr) });
    }
    throw lastErr;
  };

  const post = async (provider: LlmProvider): Promise<ChatResponse> => {
    const body = {
      model: provider.model,
      messages,
      ...(tools.length && { tools, tool_choice: "auto" }),
      ...(opts.maxTokens !== undefined && { max_tokens: opts.maxTokens }),
      ...(opts.temperature !== undefined && { temperature: opts.temperature }),
    };
    const timeoutMs = opts.requestTimeoutMs ?? 60_000;
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    let r: Response;
    let raw: string;
    try {
      r = await fetchFn(`${provider.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(provider.apiKey && { authorization: `Bearer ${provider.apiKey}` }),
          ...provider.headers,
        },
        body: JSON.stringify(body),
        signal,
      });
      raw = await r.text();
    } catch (e) {
      if (timeout.aborted && !opts.signal?.aborted) throw new RequestTimeout(`${provider.name}: no response within ${timeoutMs / 1000}s`);
      throw e;
    }
    let json: ChatResponse | undefined;
    try {
      json = JSON.parse(raw) as ChatResponse;
    } catch {
      // non-JSON error page
    }
    const apiErr = json?.error ? (typeof json.error === "string" ? json.error : json.error.message) : undefined;
    if (!r.ok || !json || apiErr || !json.choices?.length) {
      const retryAfter = Number(r.headers.get("retry-after"));
      throw new HttpError(
        r.ok ? 502 : r.status,
        `${provider.name} ${r.status}: ${(apiErr ?? raw).slice(0, 300) || "empty response"}`,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
      );
    }
    return json;
  };

  const max = opts.maxIterations ?? 20;
  let turns = 0;
  let last = { provider: providers[0]!.name, model: providers[0]!.model };
  for (;;) {
    const { res, provider } = await complete();
    turns++;
    const choice = res.choices![0]!;
    const m = choice.message ?? {};
    last = { provider: provider.name, model: res.model ?? provider.model };
    const reasoning = m.reasoning_content ?? m.reasoning;
    if (reasoning) opts.onEvent?.({ type: "thinking", text: reasoning });
    if (m.content) opts.onEvent?.({ type: "text", text: m.content });

    const calls = (m.tool_calls ?? []).map((c, i) => ({ ...c, type: "function" as const, id: c.id || `call_${turns}_${i}` }));
    messages.push({ role: "assistant", content: m.content ?? null, ...(calls.length && { tool_calls: calls }) });
    for (const c of calls) {
      let input: unknown;
      try {
        input = c.function.arguments ? JSON.parse(c.function.arguments) : {};
      } catch {
        input = undefined;
      }
      opts.onEvent?.({ type: "tool_use", id: c.id, name: c.function.name, input: input ?? c.function.arguments });
    }
    const stopReason = calls.length ? "tool_calls" : (choice.finish_reason ?? null);
    opts.onEvent?.({
      type: "turn",
      stopReason,
      usage: { input_tokens: res.usage?.prompt_tokens ?? 0, output_tokens: res.usage?.completion_tokens ?? 0 },
      ...last,
    });
    if (!calls.length) return { messages, text: m.content ?? "", stopReason, turns, ...last };

    for (const c of calls) {
      messages.push({ role: "tool", tool_call_id: c.id, content: await runCall(byName, c, opts.signal) });
    }
    if (turns >= max) return { messages, text: "", stopReason: "max_iterations", turns, ...last };
  }
}

async function runCall(byName: Map<string, AnyKitTool>, c: ToolCall, signal?: AbortSignal): Promise<string> {
  const tool = byName.get(c.function.name);
  if (!tool) return `Error: unknown tool "${c.function.name}". Available: ${[...byName.keys()].join(", ")}`;
  let args: unknown;
  try {
    args = c.function.arguments ? JSON.parse(c.function.arguments) : {};
  } catch {
    return `Error: arguments are not valid JSON: ${c.function.arguments.slice(0, 200)}`;
  }
  return (await callTool(tool, args, signal ? { signal } : {})).text;
}

const label = (p: LlmProvider) => `${p.name}/${p.model}`;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });
}
