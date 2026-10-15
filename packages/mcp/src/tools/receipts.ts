import type { Anchorer, ReceiptLog, Uploader } from "@iamyoungjohn-kit/receipts";
import { verifyLog } from "@iamyoungjohn-kit/receipts";
import { z } from "zod";
import { defineTool, type AnyKitTool } from "../tool.js";

/** Give the agent access to its own verifiable action log. */
export function receiptTools(log: ReceiptLog, publish?: { anchorer?: Anchorer; uploader?: Uploader }) {
  const tools: AnyKitTool[] = [
    defineTool({
      name: "receipts_note",
      description:
        "Record a decision or rationale in your signed, tamper-evident action log (e.g. why you chose a vendor or declined a payment). Keep it short and factual.",
      input: z.object({ note: z.string().max(2000), tags: z.array(z.string()).optional() }),
      run: async ({ note, tags }) => {
        const r = await log.append("agent.note", { note, ...(tags && { tags }) });
        return { seq: r.seq, hash: r.hash };
      },
    }),
    defineTool({
      name: "receipts_recent",
      description: "The most recent entries of your action log (type, time, data, hash).",
      input: z.object({ limit: z.number().int().min(1).max(50).default(10) }),
      annotations: { readOnlyHint: true },
      run: async ({ limit }) =>
        (await log.list()).slice(-limit).map((r) => ({ seq: r.seq, type: r.type, ts: new Date(r.ts).toISOString(), data: r.data, hash: r.hash })),
    }),
    defineTool({
      name: "receipts_verify",
      description: "Verify the integrity of your action log (hash chain + signatures). Returns ok, count, head hash and any errors.",
      input: z.object({}),
      annotations: { readOnlyHint: true },
      run: async () => verifyLog(await log.list()),
    }),
  ];
  if (publish && (publish.anchorer || publish.uploader)) {
    tools.push(
      defineTool({
        name: "receipts_publish",
        description:
          "Publish your action log: upload it and anchor its head hash onchain so anyone can verify it later. Costs a transaction; do it at milestones, not after every step.",
        input: z.object({}),
        run: async () => {
          const r = await log.publish(publish);
          return { checkpoint: r.checkpoint, upload: r.upload ?? null, anchor: r.anchor ?? null };
        },
      }),
    );
  }
  return tools;
}
