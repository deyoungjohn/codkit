import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { toAiSdkTools } from "@codkit/mcp/ai-sdk";
import { createMcpServer } from "@codkit/mcp/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { generateText, isStepCount } from "ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RECIPIENT } from "./anvil.js";
import { createWorld } from "./world.js";

let world: Awaited<ReturnType<typeof createWorld>>;
beforeAll(async () => {
  world = await createWorld();
});
afterAll(() => world.stop());

type Call = { id: string; name: string; args: unknown };

/** A scripted OpenAI-compatible endpoint: replays `turns`, records each request's messages. */
async function scriptedModel(turns: ({ calls: Call[] } | { text: string })[]) {
  const requests: { messages: { role: string; content?: unknown }[]; tools?: { function: { name: string } }[] }[] = [];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push(JSON.parse(body));
      const turn = turns[requests.length - 1] ?? { text: "(script ended)" };
      const message =
        "calls" in turn
          ? {
              role: "assistant",
              content: null,
              tool_calls: turn.calls.map((c) => ({
                id: c.id,
                type: "function",
                function: { name: c.name, arguments: JSON.stringify(c.args) },
              })),
            }
          : { role: "assistant", content: turn.text };
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "x",
          object: "chat.completion",
          created: 0,
          model: "scripted",
          choices: [{ index: 0, finish_reason: "calls" in turn ? "tool_calls" : "stop", message }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const model = createOpenAICompatible({
    name: "scripted",
    baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    apiKey: "k",
  })("scripted");
  return { model, requests, close: () => server.close() };
}

/** Tool results in order. Every request repeats the whole history, so the last request has them all. */
const toolResults = (requests: { messages: { role: string; content?: unknown }[] }[]) =>
  requests
    .at(-1)!
    .messages.filter((m) => m.role === "tool")
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)));

describe("the same tools on every surface", () => {
  it("Vercel AI SDK: a model checks its balance, quotes, previews a swap and is stopped from overspending", async () => {
    const { tools, engine } = world.setup();
    const api = await scriptedModel([
      { calls: [{ id: "1", name: "get_balance", args: { chain: "anvil" } }] },
      { calls: [{ id: "2", name: "quote_swap", args: { chain: "anvil", from: "TUSD", to: "TOKB", amount: "10" } }] },
      { calls: [{ id: "3", name: "swap", args: { chain: "anvil", from: "TUSD", to: "TOKB", amount: "10", dryRun: true } }] },
      { calls: [{ id: "4", name: "transfer", args: { chain: "anvil", token: "TUSD", to: RECIPIENT, amount: "500" } }] },
      { text: "Done." },
    ]);
    const bBefore = await world.bal(world.TOKB, world.agent());
    const res = await generateText({
      model: api.model,
      tools: toAiSdkTools(tools),
      stopWhen: isStepCount(8),
      prompt: "check, quote, preview, then try an oversized transfer",
    });
    api.close();

    expect(res.text).toBe("Done.");
    expect(api.requests[0]!.tools!.map((t) => t.function.name).sort()).toEqual(["get_balance", "quote_swap", "swap", "transfer"]);
    const results = toolResults(api.requests);
    expect(JSON.parse(results[0]!).balances.TUSD).toMatch(/^\d+(\.\d+)?$/);
    expect(JSON.parse(results[1]!)).toMatchObject({ provider: "toy", buy: { token: "TOKB", expected: "10" } });
    expect(JSON.parse(results[2]!)).toMatchObject({ dryRun: true, wouldSucceed: true });
    expect(results[3]).toContain("per-call cap"); // the model's oversized transfer reached it as a tool error
    // nothing moved: the preview sent nothing and the oversized transfer was refused
    expect(await world.bal(world.TOKB, world.agent())).toBe(bBefore);
    expect((await engine.spendStore.list()).filter((s) => s.amount === 500_000_000n)).toEqual([]);
  });

  it("MCP: a real client lists the tools with schemas, calls them, and gets cap errors as isError", async () => {
    const { tools } = world.setup();
    const server = createMcpServer(tools, { name: "agent-tools-test" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(a), client.connect(b)]);

    const listed = await client.listTools();
    expect(listed.tools.map((t) => t.name).sort()).toEqual(["get_balance", "quote_swap", "swap", "transfer"]);
    const transfer = listed.tools.find((t) => t.name === "transfer")!;
    expect(transfer.inputSchema).toMatchObject({
      type: "object",
      properties: { chain: { enum: ["anvil"] }, amount: { type: "string" }, dryRun: { type: "boolean" } },
    });
    expect(listed.tools.find((t) => t.name === "get_balance")!.annotations).toMatchObject({ readOnlyHint: true });

    const text = (r: unknown) => (r as { content: { text: string }[] }).content[0]!.text;
    const bal = await client.callTool({ name: "get_balance", arguments: { chain: "anvil" } });
    expect(JSON.parse(text(bal)).balances).toHaveProperty("TUSD");
    const dry = await client.callTool({
      name: "transfer",
      arguments: { chain: "anvil", token: "TUSD", to: RECIPIENT, amount: "5", dryRun: true },
    });
    expect(JSON.parse(text(dry))).toMatchObject({ dryRun: true, wouldSucceed: true });
    const over = await client.callTool({ name: "transfer", arguments: { chain: "anvil", token: "TUSD", to: RECIPIENT, amount: "999" } });
    expect(over.isError).toBe(true);
    expect(text(over)).toContain("per-call cap");
    await client.close();
  });
});
