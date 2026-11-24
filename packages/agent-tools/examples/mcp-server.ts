/**
 * The same tools as a stdio MCP server, for Claude Desktop, Cursor or any MCP client. Dry run unless `--live`.
 *
 *   npx tsx --env-file=../../.env examples/mcp-server.ts            # in packages/agent-tools
 *
 * Client config: { "command": "npx", "args": ["tsx", "--env-file=/abs/path/.env", "/abs/path/examples/mcp-server.ts"] }
 * Logs go to stderr: stdout belongs to the protocol.
 */
import { serveStdio } from "@codkit/mcp/server";
import { setup } from "./setup.js";

const live = process.argv.includes("--live");
const { tools, address } = setup({ dryRun: !live });
await serveStdio(tools, {
  name: "codkit-agent-tools",
  instructions:
    "Wallet tools for Base Sepolia (testnet): get_balance, transfer, quote_swap, swap. Each call is capped; prefer dryRun first.",
});
console.error(`codkit agent-tools MCP server on stdio · ${live ? "LIVE" : "dry run"} · ${address}`);
