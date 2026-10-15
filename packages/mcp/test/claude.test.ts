import Anthropic from "@anthropic-ai/sdk";
import { usdc } from "@codkit/policy";
import { describe, expect, it } from "vitest";
import { runAgent, toClaudeTools, type AgentEvent } from "../src/claude.js";
import { policyTools } from "../src/tools/policy.js";
import { CHAIN, fixtures, USDC } from "./helpers.js";

/** Scripted Messages API: returns `replies` in order and records request bodies. */
function scriptedClient(replies: Partial<Anthropic.Beta.BetaMessage>[]) {
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    const reply = replies[requests.length - 1];
    if (!reply) throw new Error("unexpected extra request");
    const message = {
      id: `msg_${requests.length}`,
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 20 },
      ...reply,
    };
    return new Response(JSON.stringify(message), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { client: new Anthropic({ apiKey: "test", fetch: fetch as typeof globalThis.fetch, maxRetries: 0 }), requests };
}

const checkArgs = (amount: bigint) => ({
  chain: CHAIN,
  kind: "x402_payment",
  to: "0x1111111111111111111111111111111111111111",
  spends: [{ asset: USDC, amount: amount.toString() }],
});

describe("runAgent (tool runner)", () => {
  it("runs tools the model calls, feeds results back, and returns the final answer", async () => {
    const { engine } = fixtures();
    const { client, requests } = scriptedClient([
      {
        stop_reason: "tool_use",
        content: [
          { type: "thinking", thinking: "Check the budget before paying.", signature: "sig" },
          { type: "tool_use", id: "tu_1", name: "policy_check", input: checkArgs(usdc(9)) },
        ],
      },
      { stop_reason: "end_turn", content: [{ type: "text", text: "9 USDC is over the 5 USDC per-payment cap, so I didn't pay.", citations: null }] },
    ] as Partial<Anthropic.Beta.BetaMessage>[]);

    const events: AgentEvent[] = [];
    const res = await runAgent({ client, tools: policyTools(engine), prompt: "Pay 9 USDC for the report", system: "You are a careful agent.", onEvent: (e) => events.push(e) });

    expect(res).toMatchObject({ stopReason: "end_turn", turns: 2 });
    expect(res.text).toMatch(/over the 5 USDC/);
    expect(events.map((e) => e.type)).toEqual(["thinking", "tool_use", "turn", "text", "turn"]);

    // request shape: model, adaptive thinking, effort, fallbacks, tools from Zod
    const first = requests[0]!;
    expect(first.body).toMatchObject({
      model: "claude-opus-5-5",
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "high" },
      fallbacks: "default",
      system: "You are a careful agent.",
    });
    expect(first.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect((first.body.tools as { name: string }[]).map((t) => t.name)).toEqual(["policy_check", "policy_status", "policy_halt"]);

    // second request carries the tool result produced by the real policy engine
    const lastUser = (requests[1]!.body.messages as { role: string; content: unknown }[]).at(-1)!;
    expect(lastUser.role).toBe("user");
    const result = (lastUser.content as { type: string; tool_use_id: string; content: unknown }[])[0]!;
    expect(result).toMatchObject({ type: "tool_result", tool_use_id: "tu_1" });
    expect(JSON.stringify(result.content)).toContain('\\"verdict\\": \\"deny\\"');
  });

  it("reports tool failures to the model as is_error results", async () => {
    const { engine } = fixtures();
    const { client, requests } = scriptedClient([
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_x", name: "policy_check", input: { chain: 42 } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Fixed my input.", citations: null }] },
    ] as Partial<Anthropic.Beta.BetaMessage>[]);
    await runAgent({ client, tools: policyTools(engine), prompt: "go", fallbacks: false });
    expect(requests[0]!.body.fallbacks).toBeUndefined();
    const tr = ((requests[1]!.body.messages as { content: unknown }[]).at(-1)!.content as Record<string, unknown>[])[0]!;
    expect(tr).toMatchObject({ type: "tool_result", is_error: true });
    expect(JSON.stringify(tr.content)).toMatch(/expected string, received number/); // the runner validates with Zod before run()
  });

  it("converts kit tools to runnable Claude tools", () => {
    const [t] = toClaudeTools(policyTools(fixtures().engine));
    expect(t).toMatchObject({ name: "policy_check", input_schema: { type: "object" } });
  });
});
