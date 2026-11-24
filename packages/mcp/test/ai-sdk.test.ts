import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, isStepCount } from "ai";
import { afterEach, describe, expect, it } from "vitest";
import { toAiSdkTools } from "../src/ai-sdk.js";
import { boom, echo } from "./helpers.js";

type Reply = { content?: string; calls?: { id: string; name: string; args: unknown }[] };

/** A scripted OpenAI-compatible Chat Completions endpoint; records every request body. */
async function scriptedApi(replies: Reply[]) {
  const requests: {
    messages: { role: string; content?: unknown; tool_calls?: unknown }[];
    tools?: { function: { name: string; parameters: Record<string, unknown> } }[];
  }[] = [];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push(JSON.parse(body));
      const reply = replies[requests.length - 1] ?? { content: "(no more scripted replies)" };
      const message = reply.calls
        ? {
            role: "assistant",
            content: null,
            tool_calls: reply.calls.map((c) => ({
              id: c.id,
              type: "function",
              function: { name: c.name, arguments: JSON.stringify(c.args) },
            })),
          }
        : { role: "assistant", content: reply.content ?? "" };
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "cmpl-1",
          object: "chat.completion",
          created: 0,
          model: "scripted",
          choices: [{ index: 0, finish_reason: reply.calls ? "tool_calls" : "stop", message }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const model = createOpenAICompatible({
    name: "scripted",
    baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    apiKey: "test",
  })("scripted");
  return { model, requests, close: () => server.close() };
}

let api: Awaited<ReturnType<typeof scriptedApi>> | undefined;
afterEach(() => api?.close());

describe("toAiSdkTools", () => {
  it("lets the model call a kit tool through generateText and use the result", async () => {
    api = await scriptedApi([{ calls: [{ id: "c1", name: "echo", args: { message: "yo", times: 2 } }] }, { content: "It said yo twice." }]);
    const calls: unknown[] = [];
    const tools = toAiSdkTools([echo], { onResult: (e) => calls.push(e) });
    const res = await generateText({ model: api.model, tools, stopWhen: isStepCount(5), prompt: "say yo twice" });

    expect(res.text).toBe("It said yo twice.");
    expect(res.steps).toHaveLength(2);
    // the request advertised our tool with its JSON schema
    const advertised = api.requests[0]!.tools![0]!.function;
    expect(advertised.name).toBe("echo");
    expect(advertised.parameters).toMatchObject({ type: "object", properties: { message: { type: "string" } } });
    // the result went back to the model as plain JSON (bigint → string)
    const toolMsg = api.requests[1]!.messages.find((m) => m.role === "tool")!;
    expect(JSON.parse(toolMsg.content as string)).toEqual({ echoed: ["yo", "yo"], big: "18446744073709551616" });
    expect(calls).toEqual([expect.objectContaining({ name: "echo", ok: true })]);
  });

  it("reports a failing tool to the model as an error it can react to", async () => {
    api = await scriptedApi([{ calls: [{ id: "c1", name: "boom", args: {} }] }, { content: "That failed." }]);
    const res = await generateText({ model: api.model, tools: toAiSdkTools([boom]), stopWhen: isStepCount(5), prompt: "go" });
    expect(res.text).toBe("That failed.");
    const toolMsg = api.requests[1]!.messages.find((m) => m.role === "tool")!;
    expect(JSON.stringify(toolMsg.content)).toContain("kaboom");
  });

  it("does not run a tool whose input fails its schema", async () => {
    api = await scriptedApi([{ calls: [{ id: "c1", name: "echo", args: { message: 42 } }] }, { content: "Bad input." }]);
    const calls: unknown[] = [];
    await generateText({
      model: api.model,
      tools: toAiSdkTools([echo], { onResult: (e) => calls.push(e) }),
      stopWhen: isStepCount(5),
      prompt: "go",
    });
    expect(calls).toEqual([]); // never executed
    expect(JSON.stringify(api.requests[1]!.messages.find((m) => m.role === "tool")!.content)).toMatch(/invalid|expected|string/i);
  });
});
