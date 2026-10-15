/**
 * Serve kit tools over MCP. Import from `@codkit/mcp/server`.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { callTool, type AnyKitTool } from "./tool.js";

export interface KitServerOptions {
  name: string;
  version?: string;
  /** Shown to clients that support it: how to use these tools together. */
  instructions?: string;
}

/** An `McpServer` with every tool registered (input validated by Zod, errors returned as `isError`). */
export function createMcpServer(tools: AnyKitTool[], opts: KitServerOptions): McpServer {
  const server = new McpServer(
    { name: opts.name, version: opts.version ?? "0.1.0" },
    opts.instructions ? { instructions: opts.instructions } : {},
  );
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.input,
        ...(tool.title && { title: tool.title }),
        ...(tool.annotations && { annotations: tool.annotations }),
      },
      async (args: unknown, extra: { signal?: AbortSignal }) => {
        const res = await callTool(tool, args, extra.signal ? { signal: extra.signal } : {});
        return { content: [{ type: "text" as const, text: res.text }], ...(!res.ok && { isError: true }) };
      },
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
 * const mcp = mcpHttpHandler(tools, { name: "my-agent" });
 * app.all("/mcp", (c) => mcp(c.req.raw));
 * ```
 *
 * Stateless: a fresh server per request, so it scales horizontally and needs no
 * session store. Put auth in front of it — these tools can move money.
 */
export function mcpHttpHandler(tools: AnyKitTool[], opts: KitServerOptions): (req: Request) => Promise<Response> {
  return async (req) => {
    const server = createMcpServer(tools, opts);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(req);
    } finally {
      void server.close();
    }
  };
}
