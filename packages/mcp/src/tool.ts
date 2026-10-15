import { z } from "zod";

/** MCP-style hints; Claude and WebMCP ignore what they don't use. */
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolContext {
  signal?: AbortSignal;
}

/**
 * One tool definition, exposed three ways: MCP server (`/server`), Claude tool
 * runner (`/claude`), browser WebMCP (`/webmcp`).
 */
export interface KitTool<S extends z.ZodObject = z.ZodObject> {
  /** `snake_case`, unique within a toolset. */
  name: string;
  title?: string;
  /** Written for the model: what it does, when to use it, what it returns. */
  description: string;
  input: S;
  annotations?: ToolAnnotations;
  /** Return any JSON-ish value (bigints are stringified). Throw to report an error to the model. */
  run(input: z.infer<S>, ctx: ToolContext): Promise<unknown>;
}

export type AnyKitTool = KitTool<z.ZodObject>;

export function defineTool<S extends z.ZodObject>(tool: KitTool<S>): KitTool<S> {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name)) throw new Error(`invalid tool name "${tool.name}"`);
  return tool;
}

export type ToolOutcome = { ok: true; value: unknown; text: string } | { ok: false; error: string; text: string };

/** Validate raw args, run, and render the result as text. Never throws. */
export async function callTool(tool: AnyKitTool, args: unknown, ctx: ToolContext = {}): Promise<ToolOutcome> {
  const parsed = tool.input.safeParse(args ?? {});
  if (!parsed.success) {
    const error = `invalid input: ${z.prettifyError(parsed.error)}`;
    return { ok: false, error, text: `Error: ${error}` };
  }
  try {
    const value = await tool.run(parsed.data, ctx);
    return { ok: true, value, text: toText(value) };
  } catch (e) {
    const error = errorMessage(e);
    return { ok: false, error, text: `Error: ${error}` };
  }
}

/** JSON text for the model; bigint-safe, strings passed through. */
export function toText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "ok";
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "code" in e && "message" in e && typeof e.message === "string") {
    return `${String((e as { code: unknown }).code)}: ${e.message}`; // e.g. PolicyError
  }
  return e instanceof Error ? e.message : String(e);
}

export type ToolEvent =
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; ok: boolean; output: string; ms: number };

export interface InstrumentOptions {
  onEvent?: (e: ToolEvent) => void;
  /** e.g. a `ReceiptLog` — every call and result becomes a signed receipt. */
  receipts?: { append(type: string, data: unknown): Promise<unknown> };
}

/**
 * Wrap tools so every call emits events (for a live dashboard / reasoning trace)
 * and, optionally, lands in the receipt log. Surface-agnostic: the wrapped tools
 * work with MCP, Claude and WebMCP alike.
 */
export function instrument<T extends AnyKitTool[]>(tools: T, opts: InstrumentOptions): T {
  return tools.map((t) => ({
    ...t,
    async run(input: unknown, ctx: ToolContext) {
      const id = crypto.randomUUID();
      const started = Date.now();
      opts.onEvent?.({ type: "tool_call", id, name: t.name, input });
      await opts.receipts?.append("tool.call", { id, name: t.name, input });
      try {
        const value = await t.run(input as never, ctx);
        const output = toText(value);
        opts.onEvent?.({ type: "tool_result", id, name: t.name, ok: true, output, ms: Date.now() - started });
        await opts.receipts?.append("tool.result", { id, name: t.name, ok: true, output: truncate(output) });
        return value;
      } catch (e) {
        const output = errorMessage(e);
        opts.onEvent?.({ type: "tool_result", id, name: t.name, ok: false, output, ms: Date.now() - started });
        await opts.receipts?.append("tool.result", { id, name: t.name, ok: false, output });
        throw e;
      }
    },
  })) as unknown as T;
}

const truncate = (s: string, n = 4000) => (s.length > n ? `${s.slice(0, n)}…(${s.length - n} more chars)` : s);
