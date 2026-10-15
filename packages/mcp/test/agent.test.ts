import { usdc } from "@codkit/policy";
import { describe, expect, it } from "vitest";
import { providersFromEnv, runAgent, toOpenAITools, type AgentEvent, type LlmProvider } from "../src/agent.js";
import { policyTools } from "../src/tools/policy.js";
import { CHAIN, fixtures, USDC } from "./helpers.js";

type Reply = { status?: number; body: unknown; headers?: Record<string, string> };

/** Scripted Chat Completions API: returns `replies` in order and records requests. */
function scripted(replies: Reply[]) {
  const requests: { url: string; headers: Headers; body: Record<string, any> }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    const reply = replies[requests.length - 1];
    if (!reply) throw new Error("unexpected extra request");
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { "content-type": "application/json", ...reply.headers } });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

const completion = (message: Record<string, unknown>, finish_reason = "stop") => ({
  body: { model: "m", choices: [{ index: 0, finish_reason, message: { role: "assistant", content: null, ...message } }], usage: { prompt_tokens: 100, completion_tokens: 20 } },
});
const call = (id: string, name: string, args: unknown) => ({ id, type: "function", function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } });

const checkArgs = (amount: bigint) => ({
  chain: CHAIN,
  kind: "x402_payment",
  to: "0x1111111111111111111111111111111111111111",
  spends: [{ asset: USDC, amount: amount.toString() }],
});

const groq: LlmProvider = { name: "groq", baseUrl: "https://api.groq.test/openai/v1/", apiKey: "k1", model: "gpt-oss" };
const gemini: LlmProvider = { name: "gemini", baseUrl: "https://gemini.test/v1beta/openai", apiKey: "k2", model: "flash" };

describe("runAgent (OpenAI-compatible loop)", () => {
  it("runs tools the model calls, feeds results back, and returns the final answer", async () => {
    const { engine } = fixtures();
    const { fetch, requests } = scripted([
      completion({ reasoning: "Check the budget before paying.", tool_calls: [call("c1", "policy_check", checkArgs(usdc(9)))] }, "tool_calls"),
      completion({ content: "9 USDC is over the 5 USDC per-payment cap, so I didn't pay." }),
    ]);
    const events: AgentEvent[] = [];
    const res = await runAgent({ fetch, providers: groq, tools: policyTools(engine), prompt: "Pay 9 USDC", system: "Be careful.", onEvent: (e) => events.push(e) });

    expect(res).toMatchObject({ stopReason: "stop", turns: 2, provider: "groq", model: "m" });
    expect(res.text).toMatch(/over the 5 USDC/);
    expect(events.map((e) => e.type)).toEqual(["thinking", "tool_use", "turn", "text", "turn"]);
    expect(events[1]).toMatchObject({ type: "tool_use", id: "c1", name: "policy_check", input: { chain: CHAIN } });

    const first = requests[0]!;
    expect(first.url).toBe("https://api.groq.test/openai/v1/chat/completions");
    expect(first.headers.get("authorization")).toBe("Bearer k1");
    expect(first.body).toMatchObject({ model: "gpt-oss", tool_choice: "auto", messages: [{ role: "system", content: "Be careful." }, { role: "user", content: "Pay 9 USDC" }] });
    expect(first.body.tools.map((t: any) => t.function.name)).toEqual(["policy_check", "policy_status", "policy_halt"]);
    expect(JSON.stringify(first.body)).not.toContain("null"); // some relays reject null fields

    // second request carries the assistant tool call and the real policy engine's verdict
    const [assistant, tool] = requests[1]!.body.messages.slice(-2);
    expect(assistant).toMatchObject({ role: "assistant", tool_calls: [{ id: "c1" }] });
    expect(assistant).not.toHaveProperty("reasoning");
    expect(tool).toMatchObject({ role: "tool", tool_call_id: "c1" });
    expect(tool.content).toContain('"verdict": "deny"');
    expect(res.messages.at(-1)).toMatchObject({ role: "assistant", content: res.text });
  });

  it("reports bad input, bad JSON and unknown tools to the model as errors", async () => {
    const { engine } = fixtures();
    const { fetch, requests } = scripted([
      completion({ tool_calls: [call("a", "policy_check", { chain: 42 }), call("b", "policy_status", "{oops"), call("", "nope", {})] }),
      completion({ content: "Fixed." }),
    ]);
    await runAgent({ fetch, providers: groq, tools: policyTools(engine), prompt: "go" });
    const results = requests[1]!.body.messages.filter((m: any) => m.role === "tool");
    expect(results.map((m: any) => m.tool_call_id)).toEqual(["a", "b", "call_1_2"]);
    expect(results[0].content).toMatch(/^Error: invalid input/);
    expect(results[1].content).toMatch(/not valid JSON/);
    expect(results[2].content).toMatch(/unknown tool "nope"/);
  });

  it("retries 429s, then fails over to the next provider and stays there", async () => {
    const { engine } = fixtures();
    const limited = { status: 429, body: { error: { message: "rate limited" } }, headers: { "retry-after": "0" } };
    const { fetch, requests } = scripted([
      limited,
      limited,
      completion({ tool_calls: [call("c1", "policy_status", {})] }),
      completion({ content: "done" }),
    ]);
    const events: AgentEvent[] = [];
    const res = await runAgent({ fetch, providers: [groq, gemini], retries: 1, maxBackoffMs: 1, tools: policyTools(engine), prompt: "go", onEvent: (e) => events.push(e) });
    expect(requests.map((r) => new URL(r.url).host)).toEqual(["api.groq.test", "api.groq.test", "gemini.test", "gemini.test"]);
    expect(events.find((e) => e.type === "failover")).toMatchObject({ from: "groq/gpt-oss", to: "gemini/flash", error: expect.stringContaining("429") });
    expect(res.provider).toBe("gemini");
  });

  it("fails over immediately on non-retryable errors and throws when all providers fail", async () => {
    const { fetch, requests } = scripted([
      { status: 401, body: { error: { message: "bad key" } } },
      { status: 404, body: { error: "no such model" } },
    ]);
    await expect(runAgent({ fetch, providers: [groq, gemini], tools: [], prompt: "hi" })).rejects.toThrow(/gemini 404: no such model/);
    expect(requests).toHaveLength(2);
    expect(requests[0]!.body).not.toHaveProperty("tools");
  });

  it("stops at maxIterations", async () => {
    const { engine } = fixtures();
    const loop = completion({ tool_calls: [call("c", "policy_status", {})] });
    const { fetch } = scripted([loop, loop]);
    const res = await runAgent({ fetch, providers: groq, tools: policyTools(engine), prompt: "go", maxIterations: 2 });
    expect(res).toMatchObject({ stopReason: "max_iterations", turns: 2 });
  });

  it("converts kit tools to function tools without $schema", () => {
    const [t] = toOpenAITools(policyTools(fixtures().engine));
    expect(t).toMatchObject({ type: "function", function: { name: "policy_check", parameters: { type: "object" } } });
    expect(t!.function.parameters).not.toHaveProperty("$schema");
  });
});

describe("providersFromEnv", () => {
  it("auto-detects keyed presets in order", () => {
    const ps = providersFromEnv({ OPENROUTER_API_KEY: "o", GEMINI_API_KEY: "g", LLM_MODEL: "gemini-x" });
    expect(ps.map((p) => [p.name, p.model])).toEqual([
      ["gemini", "gemini-x"],
      ["openrouter", "dots-studio/dots-3-note-preview:free"],
      ["openrouter", "nvidia/nemotron-3-ultra-550b-a55b:free"],
      ["openrouter", "google/gemma-4-31b-it:free"],
      ["openrouter", "nvidia/nemotron-3-super-120b-a12b:free"],
    ]);
    expect(providersFromEnv({})).toEqual([]);
  });

  it("honours LLM_PROVIDER order, per-provider models and custom endpoints", () => {
    const ps = providersFromEnv({
      LLM_PROVIDER: "agentrouter, custom",
      AGENTROUTER_API_KEY: "a",
      AGENTROUTER_MODEL: "deepseek-v3",
      LLM_BASE_URL: "http://localhost:11434/v1",
      CUSTOM_MODEL: "qwen3",
    });
    expect(ps).toEqual([
      { name: "agentrouter", baseUrl: "https://agentrouter.org/v1", apiKey: "a", model: "deepseek-v3" },
      { name: "custom", baseUrl: "http://localhost:11434/v1", apiKey: undefined, model: "qwen3" },
    ]);
    expect(() => providersFromEnv({ LLM_PROVIDER: "agentrouter", AGENTROUTER_API_KEY: "a" })).toThrow(/AGENTROUTER_MODEL/);
    // comma-separated models expand into failover entries
    const g = providersFromEnv({ LLM_PROVIDER: "groq", GROQ_API_KEY: "k", LLM_MODEL: "a, b" });
    expect(g.map((p) => p.model)).toEqual(["a", "b"]);
    expect(() => providersFromEnv({ LLM_PROVIDER: "groq" })).toThrow(/GROQ_API_KEY/);
    expect(() => providersFromEnv({ LLM_PROVIDER: "anthropic" })).toThrow(/unknown LLM provider/);
  });
});
