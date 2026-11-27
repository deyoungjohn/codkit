import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { createGateway } from "ai";

export interface ProviderPreset {
  /** Env vars holding the API key, first one set wins. */
  keyEnv: readonly string[];
  /** Default model; a comma-separated list means "try these in order". Override with `<NAME>_MODEL` or `LLM_MODEL`. */
  model?: string;
  /** Build a model from a key and a model id. */
  create: (apiKey: string, modelId: string) => LanguageModelV4;
}

const compatible =
  (name: string, baseURL: string, extra: { headers?: Record<string, string>; supportsStructuredOutputs?: boolean } = {}) =>
  (apiKey: string, modelId: string) =>
    createOpenAICompatible({ name, baseURL, apiKey, ...extra })(modelId) as LanguageModelV4;

/**
 * Every provider codkit knows, in auto-detect order: when `LLM_PROVIDER` is unset, each one whose key is set is
 * used, in this order. Defaults were read from each provider package's own model list (2026-11-27); free
 * catalogues (OpenRouter, NIM) churn, so override them when they go stale.
 */
export const PROVIDERS = {
  gateway: {
    keyEnv: ["AI_GATEWAY_API_KEY"],
    model: "anthropic/claude-sonnet-5.5",
    create: (apiKey, modelId) => createGateway({ apiKey })(modelId) as LanguageModelV4,
  },
  anthropic: {
    keyEnv: ["ANTHROPIC_API_KEY"],
    model: "claude-sonnet-5-5",
    create: (apiKey, modelId) => createAnthropic({ apiKey })(modelId) as LanguageModelV4,
  },
  openai: {
    keyEnv: ["OPENAI_API_KEY"],
    model: "gpt-5.5",
    create: (apiKey, modelId) => createOpenAI({ apiKey })(modelId) as LanguageModelV4,
  },
  google: {
    keyEnv: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
    model: "gemini-3.5-flash",
    create: (apiKey, modelId) => createGoogleGenerativeAI({ apiKey })(modelId) as LanguageModelV4,
  },
  groq: {
    keyEnv: ["GROQ_API_KEY"],
    model: "openai/gpt-oss-120b",
    create: (apiKey, modelId) => createGroq({ apiKey })(modelId) as LanguageModelV4,
  },
  openrouter: {
    keyEnv: ["OPENROUTER_API_KEY"],
    model: "nvidia/nemotron-3-ultra-550b-a55b:free,google/gemma-4-31b-it:free",
    // No `supportsStructuredOutputs`: many free models reject JSON-schema formats outright (a hard error that
    // stops the chain); without it a model that ignores the schema fails validation and the chain moves on.
    create: compatible("openrouter", "https://openrouter.ai/api/v1", { headers: { "X-Title": "codkit" } }),
  },
  nvidia: {
    keyEnv: ["NVIDIA_API_KEY"],
    model: "openai/gpt-oss-120b",
    create: compatible("nvidia", "https://integrate.api.nvidia.com/v1"),
  },
  // No default model: the catalogue is account-specific.
  agentrouter: {
    keyEnv: ["AGENTROUTER_API_KEY"],
    create: compatible("agentrouter", "https://agentrouter.org/v1"),
  },
} satisfies Record<string, ProviderPreset>;

export type ProviderName = keyof typeof PROVIDERS;

/** Other names people (and `@codkit/mcp`) use for the same providers. */
const ALIASES: Record<string, ProviderName> = {
  gemini: "google",
  "ai-gateway": "gateway",
  vercel: "gateway",
  nim: "nvidia",
  claude: "anthropic",
};

/** A model plus where it came from (for logs, UIs and "answered by"). */
export interface NamedModel {
  provider: ProviderName | "custom";
  modelId: string;
  model: LanguageModelV4;
}

type Env = Record<string, string | undefined>;

const list = (s: string | undefined) =>
  (s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Models from env, in fallback order.
 * - `LLM_PROVIDER=anthropic,groq` picks and orders providers (`gemini`, `claude`, `nim` and `vercel` work as aliases); `custom` uses `LLM_BASE_URL` + `LLM_API_KEY`
 *   (any OpenAI-compatible endpoint: a local Ollama, vLLM, LM Studio, a sponsor's gateway …).
 * - Unset: every provider whose key is set, in `PROVIDERS` order.
 * - Model: `<NAME>_MODEL` (e.g. `ANTHROPIC_MODEL`), else `LLM_MODEL` for the first provider, else the default.
 *   A comma-separated list becomes one fallback entry per model.
 */
export function modelsFromEnv(env: Env = process.env): NamedModel[] {
  const names = env.LLM_PROVIDER
    ? list(env.LLM_PROVIDER.toLowerCase())
    : (Object.keys(PROVIDERS) as ProviderName[]).filter((n) => PROVIDERS[n].keyEnv.some((k) => env[k]));
  return names.flatMap((given, i): NamedModel[] => {
    const name = ALIASES[given] ?? given;
    const chosen =
      env[`${given.toUpperCase().replace(/-/g, "_")}_MODEL`] || env[`${name.toUpperCase()}_MODEL`] || (i === 0 ? env.LLM_MODEL : undefined);
    if (name === "custom") {
      if (!env.LLM_BASE_URL || !chosen) throw new Error("LLM_PROVIDER=custom needs LLM_BASE_URL and CUSTOM_MODEL (or LLM_MODEL)");
      const make = compatible("custom", env.LLM_BASE_URL);
      return list(chosen).map((modelId) => ({ provider: "custom", modelId, model: make(env.LLM_API_KEY ?? "", modelId) }));
    }
    const preset: ProviderPreset | undefined = PROVIDERS[name as ProviderName];
    if (!preset) throw new Error(`unknown LLM provider "${given}" (known: ${Object.keys(PROVIDERS).join(", ")}, custom)`);
    const apiKey = preset.keyEnv.map((k) => env[k]).find(Boolean);
    if (!apiKey) throw new Error(`${name}: set ${preset.keyEnv.join(" or ")}`);
    const ids = list(chosen || preset.model);
    if (!ids.length) throw new Error(`${name}: set ${name.toUpperCase()}_MODEL (or LLM_MODEL)`);
    return ids.map((modelId) => ({ provider: name as ProviderName, modelId, model: preset.create(apiKey, modelId) }));
  });
}
