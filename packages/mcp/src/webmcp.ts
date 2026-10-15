/**
 * Expose kit tools to in-browser agents via WebMCP. Import from
 * `@codkit/mcp/webmcp`.
 *
 * Targets the current draft (`document.modelContext.registerTool(tool, { signal })`)
 * and falls back to the earlier `navigator.modelContext` shape used by polyfills.
 * No-op (returns `registered: 0`) when the page has no model context.
 */
import { z } from "zod";
import { callTool, type AnyKitTool } from "./tool.js";

interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: object;
  annotations?: object;
  execute(args: unknown, opts?: { signal?: AbortSignal }): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>;
}

interface ModelContextLike {
  registerTool(tool: WebMcpTool, opts?: { signal?: AbortSignal }): unknown;
}

export function findModelContext(scope: { document?: unknown; navigator?: unknown } = globalThis): ModelContextLike | undefined {
  const fromDoc = (scope.document as { modelContext?: ModelContextLike } | undefined)?.modelContext;
  const fromNav = (scope.navigator as { modelContext?: ModelContextLike } | undefined)?.modelContext;
  const mc = fromDoc ?? fromNav;
  return mc && typeof mc.registerTool === "function" ? mc : undefined;
}

/** Kit tool → WebMCP tool descriptor (JSON Schema input, MCP-style result). */
export function toWebMcpTool(tool: AnyKitTool): WebMcpTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.input, { target: "draft-2020-12", io: "input" }),
    ...(tool.annotations && { annotations: tool.annotations }),
    async execute(args, opts) {
      const res = await callTool(tool, args, opts?.signal ? { signal: opts.signal } : {});
      return { content: [{ type: "text", text: res.text }], ...(!res.ok && { isError: true }) };
    },
  };
}

/**
 * Register tools with the page's model context. Call the returned `unregister()`
 * (or abort your own `signal`) to remove them, e.g. on route change.
 */
export async function registerWebMcpTools(
  tools: AnyKitTool[],
  opts: { signal?: AbortSignal; modelContext?: ModelContextLike } = {},
): Promise<{ registered: number; unregister: () => void }> {
  const mc = opts.modelContext ?? findModelContext();
  if (!mc) return { registered: 0, unregister: () => {} };
  const controller = new AbortController();
  opts.signal?.addEventListener("abort", () => controller.abort(), { once: true });
  const legacy: { unregister?: () => void }[] = [];
  for (const tool of tools) {
    const ret = await mc.registerTool(toWebMcpTool(tool), { signal: controller.signal });
    if (ret && typeof (ret as { unregister?: unknown }).unregister === "function") legacy.push(ret as { unregister: () => void });
  }
  return {
    registered: tools.length,
    unregister: () => {
      controller.abort();
      for (const r of legacy) r.unregister?.();
    },
  };
}
