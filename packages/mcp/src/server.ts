/**
 * Serve kit tools over MCP. Import from `@codkit/mcp/server`.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { callTool, type AnyKitTool } from "./tool.js";

export interface KitServerOptions {
  name: string;
  version?: string;
  /** Shown to clients that support it: how to use these tools together. */
  instructions?: string;
  /**
   * Wrap each tool's MCP handler, e.g. to charge for it:
   * `wrapHandler: mcpPaywall({ payTo, tools: { report: "$0.05" } }).wrap` (from `@codkit/pay/mcp`).
   */
  wrapHandler?: <H extends ToolHandler>(toolName: string, handler: H) => H;
}

type ToolHandler = (args: unknown, extra: { signal?: AbortSignal }) => Promise<CallToolResult>;

/**
 * Who may call the HTTP endpoint. Required: these tools can move money, so the
 * handler refuses to start without a decision. Requests carry `Authorization: Bearer <token>`.
 */
export interface McpAuthOptions {
  /** Static API tokens (compared in constant time). Use long random strings, e.g. `openssl rand -hex 32`. */
  bearerTokens?: string[];
  /** Custom check, e.g. verifying an OAuth access token / JWT from your auth server. Return true to allow. */
  verify?: (token: string, req: Request) => boolean | Promise<boolean>;
  /**
   * OAuth protected-resource metadata URL (RFC 9728), advertised in `WWW-Authenticate`
   * so MCP clients can discover your authorization server.
   */
  resourceMetadataUrl?: string;
  /** Accept unauthenticated requests. Only for local development. */
  allowAnonymous?: boolean;
}

export interface McpHttpOptions extends KitServerOptions {
  auth: McpAuthOptions;
}

/** An `McpServer` with every tool registered (input validated by Zod, errors returned as `isError`). */
export function createMcpServer(tools: AnyKitTool[], opts: KitServerOptions): McpServer {
  const server = new McpServer(
    { name: opts.name, version: opts.version ?? "0.1.0" },
    opts.instructions ? { instructions: opts.instructions } : {},
  );
  for (const tool of tools) {
    const handler: ToolHandler = async (args, extra) => {
      const res = await callTool(tool, args, extra.signal ? { signal: extra.signal } : {});
      return { content: [{ type: "text" as const, text: res.text }], ...(!res.ok && { isError: true }) };
    };
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.input,
        ...(tool.title && { title: tool.title }),
        ...(tool.annotations && { annotations: tool.annotations }),
      },
      opts.wrapHandler ? opts.wrapHandler(tool.name, handler) : handler,
    );
  }
  return server;
}

/** Serve over stdio — what Claude Desktop / Claude Code / Cursor launch as a local MCP server. */
export async function serveStdio(tools: AnyKitTool[], opts: KitServerOptions): Promise<McpServer> {
  const server = createMcpServer(tools, opts);
  await server.connect(new StdioServerTransport());
  return server;
}

/**
 * Streamable HTTP handler on web-standard `Request`/`Response` — mount it in Hono,
 * Next.js route handlers, Bun, Deno or Cloudflare Workers:
 *
 * ```ts
 * const mcp = mcpHttpHandler(tools, { name: "my-agent", auth: { bearerTokens: [process.env.MCP_TOKEN!] } });
 * app.all("/mcp", (c) => mcp(c.req.raw));
 * ```
 *
 * Stateless: a fresh server per request, so it scales horizontally and needs no
 * session store. Every request is authenticated first (see `McpAuthOptions`).
 */
export function mcpHttpHandler(tools: AnyKitTool[], opts: McpHttpOptions): (req: Request) => Promise<Response> {
  const { auth, ...serverOpts } = opts;
  const tokens = (auth?.bearerTokens ?? []).filter(Boolean);
  if (!auth || (!tokens.length && !auth.verify && !auth.allowAnonymous)) {
    throw new Error(
      "mcpHttpHandler: configure auth — `auth: { bearerTokens: [...] }`, `auth: { verify }`, or `auth: { allowAnonymous: true }` for local development only",
    );
  }
  if (tokens.some((t) => t.length < 16)) throw new Error("mcpHttpHandler: bearer tokens must be at least 16 characters");
  const digests = Promise.all(tokens.map(sha256));

  const authorized = async (req: Request): Promise<"ok" | "missing" | "invalid"> => {
    if (auth.allowAnonymous) return "ok";
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
    if (!m) return "missing";
    const token = m[1]!;
    const d = await sha256(token);
    let match = false;
    for (const t of await digests) match = equal(d, t) || match; // check all: no early exit
    if (match) return "ok";
    if (auth.verify && (await auth.verify(token, req))) return "ok";
    return "invalid";
  };

  return async (req) => {
    const verdict = await authorized(req);
    if (verdict !== "ok") return unauthorized(verdict, auth.resourceMetadataUrl);
    const server = createMcpServer(tools, serverOpts);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(req);
    } finally {
      void server.close();
    }
  };
}

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

/** Constant-time comparison of two equal-length digests. */
function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function unauthorized(reason: "missing" | "invalid", resourceMetadataUrl?: string): Response {
  // RFC 6750 §3: no error code when credentials are simply absent
  const params = ['realm="mcp"', ...(reason === "invalid" ? ['error="invalid_token"'] : []), ...(resourceMetadataUrl ? [`resource_metadata="${resourceMetadataUrl}"`] : [])];
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null }), {
    status: 401,
    headers: { "content-type": "application/json", "www-authenticate": `Bearer ${params.join(", ")}` },
  });
}
