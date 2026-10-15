import { mcpHttpHandler } from "@codkit/mcp/server";
import { runtime, SYSTEM_PROMPT } from "@/lib/runtime";

export const dynamic = "force-dynamic";

/**
 * The agent's tools over MCP (Streamable HTTP), for external agents such as Claude
 * Desktop or Cursor. Same policy engine, budget, approvals and receipts as the
 * dashboard. Authenticated with a bearer token: set MCP_TOKEN (≥ 16 chars), then
 *
 *   claude mcp add --transport http codkit http://localhost:3000/api/mcp --header "Authorization: Bearer $MCP_TOKEN"
 */
async function handle(req: Request) {
  const token = process.env.MCP_TOKEN;
  if (!token) return Response.json({ error: "MCP endpoint disabled: set MCP_TOKEN" }, { status: 503 });
  const mcp = mcpHttpHandler(runtime().tools, { name: "codkit-agent", instructions: SYSTEM_PROMPT, auth: { bearerTokens: [token] } });
  return mcp(req);
}

export { handle as GET, handle as POST, handle as DELETE };
