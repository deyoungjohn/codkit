import type { LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import { APICallError, generateText, RetryError, streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { generateStructured, isTransient, modelFromEnv, modelsFromEnv, type NamedModel, withFallback } from "../src/index.js";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const answer = (text: string): LanguageModelV4GenerateResult => ({
  content: [{ type: "text", text }],
  finishReason: { unified: "stop", raw: "stop" },
  usage,
  warnings: [],
});
const fail = (statusCode: number) =>
  new APICallError({ message: `HTTP ${statusCode}`, url: "https://x", requestBodyValues: {}, statusCode, isRetryable: false });
const named = (provider: string, model: MockLanguageModelV4): NamedModel => ({
  provider: provider as NamedModel["provider"],
  modelId: model.modelId,
  model,
});
const ok = (id: string, text = "hi") => new MockLanguageModelV4({ provider: id, modelId: `${id}-m`, doGenerate: answer(text) });
const broken = (id: string, error: unknown) =>
  new MockLanguageModelV4({
    provider: id,
    modelId: `${id}-m`,
    doGenerate: async () => {
      throw error;
    },
    doStream: async () => {
      throw error;
    },
  });

describe("modelsFromEnv", () => {
  it("uses every provider with a key, in the documented order, each with its default model", () => {
    const m = modelsFromEnv({ GROQ_API_KEY: "g", ANTHROPIC_API_KEY: "a", GEMINI_API_KEY: "x" });
    expect(m.map((x) => `${x.provider}:${x.modelId}`)).toEqual([
      "anthropic:claude-sonnet-5-5",
      "google:gemini-3.5-flash",
      "groq:openai/gpt-oss-120b",
    ]);
    expect(m[0]!.model.provider).toMatch(/anthropic/);
    expect(m[2]!.model.provider).toMatch(/groq/);
  });

  it("LLM_PROVIDER picks and orders; <NAME>_MODEL and LLM_MODEL choose models; comma lists fan out", () => {
    const m = modelsFromEnv({
      LLM_PROVIDER: "openai, gateway",
      LLM_MODEL: "gpt-5.4-mini",
      GATEWAY_MODEL: "openai/gpt-5.5,google/gemini-3.5-flash",
      OPENAI_API_KEY: "o",
      AI_GATEWAY_API_KEY: "gw",
      ANTHROPIC_API_KEY: "unused",
    });
    expect(m.map((x) => `${x.provider}:${x.modelId}`)).toEqual([
      "openai:gpt-5.4-mini",
      "gateway:openai/gpt-5.5",
      "gateway:google/gemini-3.5-flash",
    ]);
  });

  it("accepts the names @codkit/mcp uses (gemini, nim …)", () => {
    const m = modelsFromEnv({
      LLM_PROVIDER: "gemini,nim",
      GEMINI_API_KEY: "g",
      GEMINI_MODEL: "gemini-3.5-flash-lite",
      NVIDIA_API_KEY: "n",
    });
    expect(m.map((x) => `${x.provider}:${x.modelId}`)).toEqual(["google:gemini-3.5-flash-lite", "nvidia:openai/gpt-oss-120b"]);
  });

  it("OpenRouter defaults to Nemotron 3.5 Super VL first", () => {
    const m = modelsFromEnv({ OPENROUTER_API_KEY: "k" });
    expect(m.map((x) => x.modelId)).toEqual(["nvidia/nemotron-3.5-super-vl:free", "google/gemma-4-31b-it:free"]);
  });

  it("custom points at any OpenAI-compatible URL", () => {
    const [m] = modelsFromEnv({ LLM_PROVIDER: "custom", LLM_BASE_URL: "http://localhost:11434/v1", LLM_MODEL: "llama3.3" });
    expect(m).toMatchObject({ provider: "custom", modelId: "llama3.3" });
  });

  it("says what is missing", () => {
    expect(() => modelsFromEnv({ LLM_PROVIDER: "anthropic" })).toThrow("anthropic: set ANTHROPIC_API_KEY");
    expect(() => modelsFromEnv({ LLM_PROVIDER: "agentrouter", AGENTROUTER_API_KEY: "k" })).toThrow("AGENTROUTER_MODEL");
    expect(() => modelsFromEnv({ LLM_PROVIDER: "mistery" })).toThrow(/unknown LLM provider "mistery"/);
    expect(() => modelsFromEnv({ LLM_PROVIDER: "custom" })).toThrow(/LLM_BASE_URL/);
    expect(modelsFromEnv({})).toEqual([]);
    expect(() => modelFromEnv({})).toThrow(/no models/);
  });
});

describe("isTransient", () => {
  it("rate limits, timeouts, outages and network failures are; bad keys and bad requests aren't", () => {
    for (const s of [408, 409, 425, 429, 500, 502, 503, 529]) expect(isTransient(fail(s)), String(s)).toBe(true);
    for (const s of [400, 401, 403, 404, 422]) expect(isTransient(fail(s)), String(s)).toBe(false);
    expect(isTransient(new RetryError({ message: "x", reason: "maxRetriesExceeded", errors: [fail(429)] }))).toBe(true);
    expect(isTransient(new TypeError("fetch failed"))).toBe(true);
    expect(isTransient(Object.assign(new Error("t"), { name: "TimeoutError" }))).toBe(true);
    expect(isTransient(new Error("bug"))).toBe(false);
  });
});

describe("withFallback", () => {
  it("moves past a rate-limited and a down provider, and reports each hop", async () => {
    const hops: string[] = [];
    const model = withFallback([named("a", broken("a", fail(429))), named("b", broken("b", fail(503))), named("c", ok("c", "from c"))], {
      onFallback: (e) => hops.push(`${e.from.provider}>${e.to.provider}`),
    });
    const { text } = await generateText({ model, prompt: "x", maxRetries: 0 });
    expect(text).toBe("from c");
    expect(hops).toEqual(["a>b", "b>c"]);
    expect(model.modelId).toBe("a:a-m > b:b-m > c:c-m");
  });

  it("does not hide a bad key behind the next provider", async () => {
    const second = ok("b");
    const model = withFallback([named("a", broken("a", fail(401))), named("b", second)]);
    await expect(generateText({ model, prompt: "x", maxRetries: 0 })).rejects.toThrow("HTTP 401");
    expect(second.doGenerateCalls).toHaveLength(0);
  });

  it("never falls back once the caller aborted", async () => {
    const second = ok("b");
    const ctrl = new AbortController();
    const first = new MockLanguageModelV4({
      provider: "a",
      modelId: "a-m",
      doGenerate: async () => {
        ctrl.abort();
        throw fail(503);
      },
    });
    const model = withFallback([first, second]);
    await expect(generateText({ model, prompt: "x", maxRetries: 0, abortSignal: ctrl.signal })).rejects.toThrow();
    expect(second.doGenerateCalls).toHaveLength(0);
  });

  it("falls back for streams while connecting", async () => {
    const good = new MockLanguageModelV4({
      provider: "b",
      modelId: "b-m",
      doStream: {
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: "text-start", id: "1" });
            c.enqueue({ type: "text-delta", id: "1", delta: "streamed" });
            c.enqueue({ type: "text-end", id: "1" });
            c.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage });
            c.close();
          },
        }),
      },
    });
    const result = streamText({ model: withFallback([broken("a", fail(429)), good]), prompt: "x", maxRetries: 0 });
    expect(await result.text).toBe("streamed");
  });

  it("gives up on a model that hangs and moves on", async () => {
    const hang = new MockLanguageModelV4({
      provider: "slow",
      modelId: "slow-m",
      doGenerate: (o) =>
        new Promise((_, reject) => o.abortSignal?.addEventListener("abort", () => reject(o.abortSignal?.reason), { once: true })),
    });
    const hops: unknown[] = [];
    const model = withFallback([hang, ok("b", "fast")], { timeoutMs: 50, onFallback: (e) => hops.push((e.error as Error).name) });
    const { text } = await generateText({ model, prompt: "x", maxRetries: 0 });
    expect(text).toBe("fast");
    expect(hops).toEqual(["TimeoutError"]);
  });
});

describe("generateStructured", () => {
  const schema = z.object({ city: z.string(), temperatureC: z.number() });

  it("returns the typed object and who produced it", async () => {
    const r = await generateStructured({
      models: [named("a", ok("a", JSON.stringify({ city: "Lagos", temperatureC: 31 })))],
      schema,
      prompt: "weather",
    });
    expect(r).toEqual({ object: { city: "Lagos", temperatureC: 31 }, provider: "a", modelId: "a-m", attempts: 1 });
  });

  it("moves on when a model answers with something that doesn't fit the schema, or is rate-limited", async () => {
    const hops: string[] = [];
    const r = await generateStructured({
      models: [
        named("weak", ok("weak", "Sure! The weather is nice.")),
        named("busy", broken("busy", fail(429))),
        named("good", ok("good", JSON.stringify({ city: "Accra", temperatureC: 29 }))),
      ],
      schema,
      prompt: "weather",
      onFallback: (e) => hops.push(`${e.from.provider}>${e.to.provider}`),
    });
    expect(r).toMatchObject({ object: { city: "Accra", temperatureC: 29 }, provider: "good", attempts: 3 });
    expect(hops).toEqual(["weak>busy", "busy>good"]);
  });

  it("times out a model that hangs", async () => {
    const hang = new MockLanguageModelV4({
      provider: "slow",
      modelId: "slow-m",
      doGenerate: (o) =>
        new Promise((_, reject) => o.abortSignal?.addEventListener("abort", () => reject(o.abortSignal?.reason), { once: true })),
    });
    const r = await generateStructured({
      models: [hang, ok("b", JSON.stringify({ city: "Abuja", temperatureC: 30 }))],
      schema,
      prompt: "x",
      timeoutMs: 50,
    });
    expect(r).toMatchObject({ provider: "b", attempts: 2 });
  });

  it("throws the last error when every model fails, and at once on a bad request", async () => {
    await expect(generateStructured({ models: [broken("a", fail(429)), broken("b", fail(503))], schema, prompt: "x" })).rejects.toThrow(
      "HTTP 503",
    );
    const spare = ok("b", "{}");
    await expect(generateStructured({ models: [broken("a", fail(400)), spare], schema, prompt: "x" })).rejects.toThrow("HTTP 400");
    expect(spare.doGenerateCalls).toHaveLength(0);
  });
});
