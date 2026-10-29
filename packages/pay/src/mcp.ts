/**
 * x402 for MCP tool calls. Import from `@codkit/pay/mcp` (needs `@x402/mcp`).
 *
 * Server: price tools by name, then wrap their handlers. Client: put an MCP
 * client behind the same policy engine as `createBudgetedFetch`.
 */
import type { PolicyEngine } from "@codkit/policy";
import type { x402Client } from "@x402/core/client";
import type { PaymentRequirements } from "@x402/core/types";
import {
  createPaymentWrapper,
  wrapMCPClientWithPayment,
  type BeforeExecutionHook,
  type MCPToolCallback,
  type PaymentWrappedHandler,
  type x402MCPClient,
} from "@x402/mcp";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { withPolicy, type PolicyHookOptions } from "./client.js";
import { createPaywall, type PaywallOptions, type RouteSpec } from "./server/core.js";

export interface McpPaywallOptions extends Omit<PaywallOptions, "routes"> {
  /** Tool name → price, e.g. `{ premium_report: "$0.05" }`. Tools not listed stay free. */
  tools: Record<string, RouteSpec>;
  /** Runs after the payment is verified, before the tool. Return false to refuse without charging. */
  onBeforeExecution?: BeforeExecutionHook;
}

/** Any MCP SDK tool callback: `(args, extra) => CallToolResult`. */
export type ToolHandler = (args: any, extra: any) => any;

export interface McpPaywall {
  /** Wrap a tool handler so it demands payment. Unpriced tools are returned unchanged. */
  wrap<H extends ToolHandler>(toolName: string, handler: H): H;
  /** Whether `toolName` has a price. */
  isPaid(toolName: string): boolean;
}

/**
 * ```ts
 * const paywall = mcpPaywall({ payTo: "0x…", tools: { premium_report: "$0.05" } });
 * createMcpServer(tools, { name: "data-shop", wrapHandler: paywall.wrap });
 * ```
 *
 * Unpaid calls get a 402 result carrying x402 `PaymentRequired`; a call with a
 * valid payment in `_meta["x402/payment"]` runs the tool and settles only if it
 * succeeded (a tool error is not charged). Settlements fire `onSettled`.
 */
export function mcpPaywall(opts: McpPaywallOptions): McpPaywall {
  const { tools, onBeforeExecution, ...rest } = opts;
  const { server, routes: configs } = createPaywall({ ...rest, routes: tools });

  let ready: Promise<void> | undefined;
  const accepts = new Map<string, Promise<PaymentRequirements[]>>();
  const requirementsFor = (name: string) => {
    let p = accepts.get(name);
    if (!p) {
      const route = configs[name]!;
      ready ??= server.initialize();
      // Dynamic prices are typed for HTTP requests; for a tool they receive `{ toolName }`.
      p = ready.then(() => server.buildPaymentRequirementsFromOptions([route.accepts].flat(), { toolName: name } as never));
      p.catch(() => accepts.delete(name)); // retry after a facilitator outage
      accepts.set(name, p);
    }
    return p;
  };

  return {
    isPaid: (name) => name in configs,
    wrap(name, handler) {
      if (!(name in configs)) return handler;
      const route = configs[name]!;
      const wrapped: ToolHandler = async (args, extra) => {
        // Built per call so the inner handler still gets the MCP `extra` (abort signal etc.).
        const paid = createPaymentWrapper(server, {
          accepts: await requirementsFor(name),
          resource: {
            url: `mcp://tool/${name}`,
            ...(route.description !== undefined && { description: route.description }),
            ...(route.mimeType !== undefined && { mimeType: route.mimeType }),
          },
          ...(onBeforeExecution && { hooks: { onBeforeExecution } }),
        });
        const inner: PaymentWrappedHandler = (a) => handler(a, extra);
        return (paid(inner) as MCPToolCallback)(args, extra);
      };
      return wrapped as typeof handler;
    },
  };
}

export interface PaidMcpClientOptions extends PolicyHookOptions {
  /** An x402 client with schemes registered, e.g. via `registerExactEvmScheme(client, { signer })`. */
  client: x402Client;
  engine: PolicyEngine;
}

/**
 * An MCP client that pays for tools within policy: the engine authorizes each
 * payment before it is signed, and commits or releases it on the result.
 * `callTool(name, args)` returns `{ content, isError, paymentMade, paymentResponse }`.
 * A blocked payment throws (`policy: <code>: …`).
 */
export function withPaidTools(mcpClient: Client, opts: PaidMcpClientOptions): x402MCPClient {
  const client = withPolicy(opts.client, opts);
  // The policy engine is the gate (caps, approval, kill switch), so no second prompt here.
  // @x402/mcp may resolve its own copy of the MCP SDK; the client is structurally the same.
  const raw = mcpClient as unknown as Parameters<typeof wrapMCPClientWithPayment>[0];
  return wrapMCPClientWithPayment(raw, client, { autoPayment: true, onPaymentRequested: () => true });
}
