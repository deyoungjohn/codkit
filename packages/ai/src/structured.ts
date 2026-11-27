import type { LanguageModelV4 } from "@ai-sdk/provider";
import { type FlexibleSchema, generateText, NoObjectGeneratedError, NoOutputGeneratedError, Output } from "ai";
import { type FallbackEvent, isTransient, withTimeout } from "./fallback.js";
import type { NamedModel } from "./providers.js";

export interface StructuredOptions<T> {
  /** One model or several in fallback order, e.g. `modelsFromEnv()`. */
  models: NamedModel | LanguageModelV4 | readonly (NamedModel | LanguageModelV4)[];
  /** A zod schema (or any schema the AI SDK accepts). */
  schema: FlexibleSchema<T>;
  prompt: string;
  system?: string;
  /** Helps the model: what the object is called and what it's for. */
  name?: string;
  description?: string;
  temperature?: number;
  abortSignal?: AbortSignal;
  /** Retries on the same model before moving to the next. Default 1: with fallback, moving on is faster. */
  maxRetries?: number;
  onFallback?: (event: FallbackEvent) => void;
  /** Give up on a model after this long and try the next one. Default 60s. */
  timeoutMs?: number;
}

export interface StructuredResult<T> {
  object: T;
  /** Which provider and model produced it. */
  provider: string;
  modelId: string;
  /** How many models were tried, the successful one included. */
  attempts: number;
}

/**
 * An object that matches `schema`, from the first model that can produce one. A rate limit, a timeout or an
 * outage moves on to the next model, and so does a model that answers with something that isn't valid for the
 * schema (weaker free-tier models do). A bad key or a bad request throws at once.
 */
export async function generateStructured<T>(opts: StructuredOptions<T>): Promise<StructuredResult<T>> {
  const models = (Array.isArray(opts.models) ? opts.models : [opts.models]) as readonly (NamedModel | LanguageModelV4)[];
  if (!models.length) throw new Error("generateStructured: no models (set an LLM key, e.g. ANTHROPIC_API_KEY or GROQ_API_KEY)");
  for (let i = 0; ; i++) {
    const current = models[i]!;
    const model = "model" in current ? current.model : current;
    try {
      const result = await withTimeout(
        opts.abortSignal,
        opts.timeoutMs ?? 60_000,
        `${current.provider}:${current.modelId}`,
        (abortSignal) =>
          generateText({
            model,
            output: Output.object({
              schema: opts.schema,
              ...(opts.name && { name: opts.name }),
              ...(opts.description && { description: opts.description }),
            }),
            prompt: opts.prompt,
            ...(opts.system && { system: opts.system }),
            ...(opts.temperature !== undefined && { temperature: opts.temperature }),
            abortSignal,
            maxRetries: opts.maxRetries ?? 1,
          }),
      );
      return { object: result.output as T, provider: current.provider, modelId: current.modelId, attempts: i + 1 };
    } catch (error) {
      const next = models[i + 1];
      const unusable = NoObjectGeneratedError.isInstance(error) || NoOutputGeneratedError.isInstance(error);
      if (!next || opts.abortSignal?.aborted || !(unusable || isTransient(error))) throw error;
      opts.onFallback?.({
        from: { provider: current.provider, modelId: current.modelId },
        to: { provider: next.provider, modelId: next.modelId },
        error,
      });
    }
  }
}
