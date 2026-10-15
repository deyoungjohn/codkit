import { createPolicyEngine, type PolicyInput } from "@iamyoungjohn-kit/policy";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse } from "@x402/core/types";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { vi } from "vitest";
import { registerExactEvmScheme, x402Client } from "../src/index.js";

export const NETWORK = "eip155:84532" as const;
export const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const PAY_TO = "0x2222222222222222222222222222222222222222";

/** In-memory facilitator: accepts every well-formed payment, records calls. */
export function fakeFacilitator(opts: { settleFails?: boolean } = {}) {
  let n = 0;
  const payerOf = (p: PaymentPayload) =>
    ((p.payload as { authorization?: { from?: string } }).authorization?.from ?? "0xunknown") as string;
  const f = {
    verify: vi.fn(async (p: PaymentPayload, r: PaymentRequirements): Promise<VerifyResponse> => {
      const ok = p.accepted.amount === r.amount && p.accepted.payTo === r.payTo;
      return ok ? { isValid: true, payer: payerOf(p) } : { isValid: false, invalidReason: "mismatch" };
    }),
    settle: vi.fn(async (p: PaymentPayload, r: PaymentRequirements): Promise<SettleResponse> => {
      if (opts.settleFails) {
        return { success: false, errorReason: "insufficient_funds", transaction: "", network: r.network, payer: payerOf(p) };
      }
      n++;
      return { success: true, transaction: `0x${n.toString(16).padStart(64, "0")}`, network: r.network, payer: payerOf(p) };
    }),
    getSupported: vi.fn(async () => ({
      kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }],
      extensions: [],
      signers: {},
    })),
  } satisfies FacilitatorClient;
  return f;
}

export function agent(policy: PolicyInput, approver?: Parameters<typeof createPolicyEngine>[0]["approver"]) {
  const account = privateKeyToAccount(generatePrivateKey());
  const engine = createPolicyEngine({ policy, ...(approver && { approver }) });
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: account });
  return { account, engine, client };
}
