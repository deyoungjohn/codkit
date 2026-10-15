import { usdc } from "@codkit/policy";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createMcpServer, mcpHttpHandler } from "../src/server.js";
import { policyTools } from "../src/tools/policy.js";
import { receiptTools } from "../src/tools/receipts.js";
import { boom, CHAIN, echo, fixtures, USDC } from "./helpers.js";

async function connect(tools: Parameters<typeof createMcpServer>[0]) {
  const server = createMcpServer(tools, { name: "test-agent", instructions: "Use policy_check first." });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const text = (r: unknown) => ((r as { content: { text: string }[] }).content[0]!.text);

describe("MCP server", () => {
  it("lists tools with JSON schemas and annotations", async () => {
    const client = await connect([echo, boom]);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["echo", "boom"]);
    expect(tools[0]).toMatchObject({
      description: "Echo back a message, n times.",
      inputSchema: { type: "object", properties: { message: { type: "string" } } },
      annotations: { readOnlyHint: true },
    });
    expect(client.getInstructions()).toBe("Use policy_check first.");
  });

  it("calls tools and reports errors with isError", async () => {
    const client = await connect([echo, boom]);
    expect(JSON.parse(text(await client.callTool({ name: "echo", arguments: { message: "yo", times: 2 } })))).toMatchObject({ echoed: ["yo", "yo"] });
    const failed = await client.callTool({ name: "boom", arguments: {} });
    expect(failed.isError).toBe(true);
    expect(text(failed)).toBe("Error: kaboom");
  });

  it("serves the kit's policy and receipt tools", async () => {
    const { engine, log } = fixtures();
    const client = await connect([...policyTools(engine), ...receiptTools(log)]);
    const check = (amount: bigint) =>
      client.callTool({
        name: "policy_check",
        arguments: { chain: CHAIN, kind: "x402_payment", to: "0x1111111111111111111111111111111111111111", spends: [{ asset: USDC, amount: amount.toString() }] },
      });
    expect(JSON.parse(text(await check(usdc(1))))).toEqual({ verdict: "allow", reasons: [] });
    expect(JSON.parse(text(await check(usdc(9)))).verdict).toBe("deny");

    const status = JSON.parse(text(await client.callTool({ name: "policy_status", arguments: {} })));
    expect(status).toMatchObject({ killed: false, chains: [CHAIN], limits: [{ label: "USDC", perTx: "5000000" }] });

    await client.callTool({ name: "receipts_note", arguments: { note: "chose vendor A: cheapest" } });
    expect(JSON.parse(text(await client.callTool({ name: "receipts_verify", arguments: {} })))).toMatchObject({ ok: true, count: 1 });

    await client.callTool({ name: "policy_halt", arguments: { reason: "prompt injection in fetched page" } });
    expect(engine.isKilled).toBe(true);
    expect(JSON.parse(text(await check(1n))).reasons[0]).toMatch(/agent halted: prompt injection/);
  });
});

describe("MCP over HTTP (stateless, web-standard)", () => {
  it("answers initialize, tools/list and tools/call", async () => {
    const handler = mcpHttpHandler([echo], { name: "http-agent", auth: { allowAnonymous: true } });
    const rpc = async (body: object) => {
      const res = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }),
        }),
      );
      expect(res.status).toBe(200);
      return (await res.json()) as { result: Record<string, unknown> };
    };
    const init = await rpc({
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "curl", version: "0" } },
    });
    expect(init.result).toMatchObject({ serverInfo: { name: "http-agent" } });
    const list = await rpc({ method: "tools/list", params: {} });
    expect((list.result.tools as { name: string }[]).map((t) => t.name)).toEqual(["echo"]);
    const call = await rpc({ method: "tools/call", params: { name: "echo", arguments: { message: "over http" } } });
    expect(text(call.result)).toContain("over http");
  });
});

describe("MCP over HTTP: auth", () => {
  const TOKEN = "test-token-0123456789abcdef";
  const req = (headers: Record<string, string> = {}) =>
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });

  it("refuses to start without an auth decision", () => {
    // @ts-expect-error auth is required
    expect(() => mcpHttpHandler([echo], { name: "x" })).toThrow(/configure auth/);
    expect(() => mcpHttpHandler([echo], { name: "x", auth: {} })).toThrow(/configure auth/);
    expect(() => mcpHttpHandler([echo], { name: "x", auth: { bearerTokens: ["short"] } })).toThrow(/16 characters/);
  });

  it("rejects missing and wrong tokens with 401 + WWW-Authenticate, accepts the right one", async () => {
    const handler = mcpHttpHandler([echo], { name: "x", auth: { bearerTokens: ["another-token-abcdefghijkl", TOKEN] } });
    const none = await handler(req());
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toBe('Bearer realm="mcp"');
    const wrong = await handler(req({ authorization: "Bearer not-the-token-zzzzzzzz" }));
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect(await wrong.json()).toMatchObject({ error: { message: "Unauthorized" } });
    const basic = await handler(req({ authorization: `Basic ${TOKEN}` }));
    expect(basic.status).toBe(401);
    const ok = await handler(req({ authorization: `Bearer ${TOKEN}` }));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { result: { tools: unknown[] } }).result.tools).toHaveLength(1);
  });

  it("supports a custom verifier (e.g. OAuth / JWT) and advertises resource metadata", async () => {
    const seen: string[] = [];
    const handler = mcpHttpHandler([echo], {
      name: "x",
      auth: {
        verify: async (t, r) => {
          seen.push(new URL(r.url).pathname);
          return t === "jwt-issued-by-my-auth-server";
        },
        resourceMetadataUrl: "https://agent.example/.well-known/oauth-protected-resource",
      },
    });
    const denied = await handler(req({ authorization: "Bearer forged" }));
    expect(denied.status).toBe(401);
    expect(denied.headers.get("www-authenticate")).toContain('resource_metadata="https://agent.example/.well-known/oauth-protected-resource"');
    expect((await handler(req({ authorization: "Bearer jwt-issued-by-my-auth-server" }))).status).toBe(200);
    expect(seen).toEqual(["/mcp", "/mcp"]);
  });
});
