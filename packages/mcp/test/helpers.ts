import { createPolicyEngine, usdc } from "@iamyoungjohn-kit/policy";
import { ed25519Signer, ReceiptLog } from "@iamyoungjohn-kit/receipts";
import { z } from "zod";
import { defineTool } from "../src/index.js";

export const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const CHAIN = "eip155:84532";

export function fixtures() {
  const engine = createPolicyEngine({
    policy: { chains: [CHAIN], limits: [{ asset: USDC, label: "USDC", perTx: usdc(5), perPeriod: { amount: usdc(20), seconds: 86_400 } }] },
  });
  const log = new ReceiptLog({ signer: ed25519Signer() });
  return { engine, log };
}

export const echo = defineTool({
  name: "echo",
  description: "Echo back a message, n times.",
  input: z.object({ message: z.string(), times: z.number().int().min(1).max(3).default(1) }),
  annotations: { readOnlyHint: true },
  run: async ({ message, times }) => ({ echoed: Array(times).fill(message), big: 2n ** 64n }),
});

export const boom = defineTool({
  name: "boom",
  description: "Always fails.",
  input: z.object({}),
  run: async () => {
    throw new Error("kaboom");
  },
});
