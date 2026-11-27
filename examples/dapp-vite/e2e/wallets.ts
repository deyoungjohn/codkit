/**
 * Test wallets for the browser. The page gets thin shims (an EIP-6963 provider and a
 * Wallet Standard wallet) that forward every request to this Node process through
 * Playwright's `exposeFunction`; keys stay here and viem / @solana/kit do the work.
 */
import {
  getBase64Decoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getTransactionEncoder,
  type KeyPairSigner,
  signBytes,
} from "@solana/kit";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright-core";
import { type Account, type Chain, createWalletClient, http, numberToHex } from "viem";

export interface EvmBackend {
  account: Account;
  chain: Chain;
  rpcUrl: string;
}

export interface SolanaBackend {
  signer: KeyPairSigner;
  /** Broadcast signed transactions here; omit to only sign (local runs against a stub RPC). */
  send?: (base64: string) => Promise<unknown>;
}

export interface Recorded {
  solana: { feePayer: string; programs: string[]; chain: string }[];
}

const b64e = getBase64Encoder();
const b64d = getBase64Decoder();

export async function installWallets(page: Page, evm: EvmBackend, sol: SolanaBackend): Promise<Recorded> {
  const recorded: Recorded = { solana: [] };
  const client = createWalletClient({ account: evm.account, chain: evm.chain, transport: http(evm.rpcUrl) });

  // Like a real wallet: no accounts until the site asks (otherwise wagmi silently reconnects on load).
  let approved = false;
  await page.exposeFunction("__codkitEvm", async (method: string, params: unknown[]) => {
    switch (method) {
      case "eth_requestAccounts":
        approved = true;
        return [evm.account.address];
      case "eth_accounts":
        return approved ? [evm.account.address] : [];
      case "eth_chainId":
        return numberToHex(evm.chain.id);
      case "wallet_switchEthereumChain":
        if (Number((params[0] as { chainId: string }).chainId) !== evm.chain.id) throw { code: 4902, message: "unknown chain" };
        return null;
      case "personal_sign":
        return evm.account.signMessage!({ message: { raw: params[0] as `0x${string}` } });
      case "eth_signTypedData_v4": {
        // JSON-RPC sends numbers as strings; viem wants bigints for the integer fields
        const td = JSON.parse(params[1] as string) as {
          domain: Record<string, unknown>;
          types: Record<string, { name: string; type: string }[]>;
          primaryType: string;
          message: Record<string, unknown>;
        };
        const { EIP712Domain: _, ...types } = td.types;
        const ints = (fields: { name: string; type: string }[] = [], o: Record<string, unknown>) =>
          Object.fromEntries(
            Object.entries(o).map(([k, v]) => [
              k,
              /^u?int\d*$/.test(fields.find((f) => f.name === k)?.type ?? "") ? BigInt(v as string) : v,
            ]),
          );
        return evm.account.signTypedData!({
          domain: td.domain,
          types,
          primaryType: td.primaryType,
          message: ints(types[td.primaryType], td.message),
        } as never);
      }
      case "eth_sendTransaction": {
        const tx = params[0] as { to: `0x${string}`; value?: `0x${string}`; data?: `0x${string}` };
        return client.sendTransaction({ to: tx.to, ...(tx.value && { value: BigInt(tx.value) }), ...(tx.data && { data: tx.data }) });
      }
      default:
        return client.request({ method, params } as never);
    }
  });

  await page.exposeFunction("__codkitSolana", async (op: string, arg: { message?: string; transaction?: string; chain?: string }) => {
    if (op === "address") return sol.signer.address;
    if (op === "signMessage") return b64d.decode(await signBytes(sol.signer.keyPair.privateKey, b64e.encode(arg.message!)));
    if (op === "signAndSend") {
      const tx = getTransactionDecoder().decode(b64e.encode(arg.transaction!));
      const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
      const keys = msg.staticAccounts;
      const ixs = (msg as unknown as { instructions: { programAddressIndex: number }[] }).instructions;
      recorded.solana.push({ feePayer: keys[0]!, programs: ixs.map((i) => keys[i.programAddressIndex]!), chain: arg.chain! });
      if (keys[0] !== sol.signer.address) throw new Error("fee payer is not the wallet");
      const sig = await signBytes(sol.signer.keyPair.privateKey, tx.messageBytes);
      const signed = { ...tx, signatures: { ...tx.signatures, [sol.signer.address]: sig } };
      const wire = b64d.decode(getTransactionEncoder().encode(signed as typeof tx));
      if (sol.send) await sol.send(wire);
      return b64d.decode(sig);
    }
    throw new Error(`unknown op ${op}`);
  });

  // A plain .js file, injected as is: a function passed here would carry the transpiler's helpers (tsx's __name).
  await page.addInitScript({ path: fileURLToPath(new URL("./inject.js", import.meta.url)) });

  return recorded;
}
