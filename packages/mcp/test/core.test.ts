import { verifyLog } from "@iamyoungjohn-kit/receipts";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { callTool, defineTool, instrument, type ToolEvent } from "../src/index.js";
import { registerWebMcpTools, toWebMcpTool } from "../src/webmcp.js";
import { boom, echo, fixtures } from "./helpers.js";

describe("defineTool / callTool", () => {
  it("validates input, applies defaults, stringifies bigints", async () => {
    const res = await callTool(echo, { message: "hi" });
    expect(res.ok).toBe(true);
    expect(JSON.parse(res.text)).toEqual({ echoed: ["hi"], big: "18446744073709551616" });
  });

  it("returns validation and runtime errors instead of throwing", async () => {
    const bad = await callTool(echo, { message: 1, times: 9 });
    expect(bad.ok).toBe(false);
    expect(bad.text).toMatch(/^Error: invalid input/);
    expect(await callTool(boom, {})).toMatchObject({ ok: false, error: "kaboom", text: "Error: kaboom" });
  });

  it("rejects bad tool names", () => {
    expect(() => defineTool({ name: "has space", description: "", input: z.object({}), run: async () => 1 })).toThrow();
  });
});

describe("instrument", () => {
  it("emits call/result events and writes signed receipts", async () => {
    const { log } = fixtures();
    const events: ToolEvent[] = [];
    const [e, b] = instrument([echo, boom], { onEvent: (ev) => events.push(ev), receipts: log });
    await callTool(e!, { message: "x" });
    await callTool(b!, {});
    expect(events.map((ev) => `${ev.type}:${ev.name}${ev.type === "tool_result" ? `:${ev.ok}` : ""}`)).toEqual([
      "tool_call:echo",
      "tool_result:echo:true",
      "tool_call:boom",
      "tool_result:boom:false",
    ]);
    const rs = await log.list();
    expect(rs.map((r) => r.type)).toEqual(["tool.call", "tool.result", "tool.call", "tool.result"]);
    expect(rs[3]!.data).toMatchObject({ name: "boom", ok: false, output: "kaboom" });
    expect((await verifyLog(rs)).ok).toBe(true);
  });
});

describe("WebMCP", () => {
  it("converts to a JSON-Schema tool with an MCP-style execute", async () => {
    const t = toWebMcpTool(echo);
    expect(t.inputSchema).toMatchObject({ type: "object", properties: { message: { type: "string" } }, required: ["message"] });
    expect(await t.execute({ message: "a", times: 2 })).toEqual({
      content: [{ type: "text", text: JSON.stringify({ echoed: ["a", "a"], big: "18446744073709551616" }, null, 2) }],
    });
    expect((await toWebMcpTool(boom).execute({})).isError).toBe(true);
  });

  it("registers with document.modelContext and unregisters via the abort signal", async () => {
    const registered = new Map<string, AbortSignal>();
    const modelContext = {
      registerTool: vi.fn(async (tool: { name: string }, o?: { signal?: AbortSignal }) => {
        registered.set(tool.name, o!.signal!);
      }),
    };
    const res = await registerWebMcpTools([echo, boom], { modelContext });
    expect(res.registered).toBe(2);
    expect([...registered.keys()]).toEqual(["echo", "boom"]);
    res.unregister();
    expect([...registered.values()].every((s) => s.aborted)).toBe(true);
  });

  it("supports the legacy { unregister } return shape and no-ops without a model context", async () => {
    const unregister = vi.fn();
    const res = await registerWebMcpTools([echo], { modelContext: { registerTool: () => ({ unregister }) } });
    res.unregister();
    expect(unregister).toHaveBeenCalledOnce();
    expect((await registerWebMcpTools([echo])).registered).toBe(0); // Node has no document.modelContext
  });
});
