import type { LanguageModelV4, LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { APICallError, RetryError } from "ai";
import type { NamedModel } from "./providers.js";

export interface FallbackEvent {
  from: { provider: string; modelId: string };
  to: { provider: string; modelId: string };
  error: unknown;
}

export interface FallbackOptions {
  /** Whether an error should move on to the next model. Default: `isTransient`. */
  shouldFallback?: (error: unknown) => boolean;
  onFallback?: (event: FallbackEvent) => void;
  /**
   * Give up on a model after this long and try the next one (default 60s). For a stream it covers connecting,
   * not the whole answer. A free tier that hangs instead of failing would otherwise stall the whole chain.
   */
  timeoutMs?: number;
}

/** Runs `call` with a signal that the caller's signal and a timer can both abort; says which one did. */
export async function withTimeout<R>(
  outer: AbortSignal | undefined,
  timeoutMs: number | undefined,
  what: string,
  call: (signal: AbortSignal) => PromiseLike<R>,
): Promise<R> {
  const ctrl = new AbortController();
  const forward = () => ctrl.abort(outer?.reason);
  if (outer?.aborted) forward();
  outer?.addEventListener("abort", forward, { once: true });
  let timedOut = false;
  const timer =
    timeoutMs && timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          ctrl.abort(Object.assign(new Error(`${what} timed out after ${timeoutMs}ms`), { name: "TimeoutError" }));
        }, timeoutMs)
      : undefined;
  try {
    return await call(ctrl.signal);
  } catch (error) {
    outer?.removeEventListener("abort", forward);
    if (timedOut && !outer?.aborted)
      throw Object.assign(new Error(`${what} timed out after ${timeoutMs}ms`), { name: "TimeoutError", cause: error });
    throw error;
  } finally {
    clearTimeout(timer); // a stream that connected keeps the signal (and the caller's abort) for its lifetime
  }
}

/**
 * The errors worth trying another provider for: rate limits, timeouts, overload and outages (HTTP 408, 409,
 * 425, 429, 5xx, or the provider saying it's retryable), the SDK's own retries running out, and network failures.
 * A bad request or a bad key (400, 401, 403, 404) is not transient: the next provider would only hide the bug.
 */
export function isTransient(error: unknown): boolean {
  if (RetryError.isInstance(error)) return isTransient(error.lastError);
  if (APICallError.isInstance(error)) {
    const s = error.statusCode;
    return error.isRetryable || s === undefined || s === 408 || s === 409 || s === 425 || s === 429 || s >= 500;
  }
  if (error instanceof Error) {
    if (error.name === "TimeoutError") return true;
    // fetch() network failures: "fetch failed", ECONNRESET, ENOTFOUND …
    return error.name === "TypeError" && /fetch|network/i.test(error.message);
  }
  return false;
}

const label = (m: NamedModel | LanguageModelV4) => ({ provider: m.provider, modelId: m.modelId });
const inner = (m: NamedModel | LanguageModelV4): LanguageModelV4 => ("model" in m ? m.model : m);

/**
 * One model that tries each of `models` in turn: a transient error (a 429, a timeout, an outage) moves on to the
 * next one. Works anywhere the AI SDK takes a model: `generateText`, `streamText`, `useChat` routes, agents.
 * A stream falls back only while connecting; once text has started flowing, an error is passed through.
 * A call the caller aborted never falls back.
 */
export function withFallback(models: readonly (NamedModel | LanguageModelV4)[], opts: FallbackOptions = {}): LanguageModelV4 {
  if (!models.length) throw new Error("withFallback: no models (set an LLM key, e.g. ANTHROPIC_API_KEY or GROQ_API_KEY)");
  const shouldFallback = opts.shouldFallback ?? isTransient;
  const first = inner(models[0]!);

  async function attempt<R>(
    options: LanguageModelV4CallOptions,
    call: (m: LanguageModelV4, o: LanguageModelV4CallOptions) => PromiseLike<R>,
  ): Promise<R> {
    for (let i = 0; ; i++) {
      const current = models[i]!;
      const { provider, modelId } = label(current);
      try {
        return await withTimeout(options.abortSignal, opts.timeoutMs ?? 60_000, `${provider}:${modelId}`, (abortSignal) =>
          call(inner(current), { ...options, abortSignal }),
        );
      } catch (error) {
        const next = models[i + 1];
        if (!next || options.abortSignal?.aborted || !shouldFallback(error)) throw error;
        opts.onFallback?.({ from: label(current), to: label(next), error });
      }
    }
  }

  return {
    specificationVersion: "v4",
    provider: "codkit-fallback",
    modelId: models.map((m) => `${label(m).provider}:${label(m).modelId}`).join(" > "),
    supportedUrls: first.supportedUrls,
    doGenerate: (options) => attempt(options, (m, o) => m.doGenerate(o)),
    doStream: (options) => attempt(options, (m, o) => m.doStream(o)),
  };
}
