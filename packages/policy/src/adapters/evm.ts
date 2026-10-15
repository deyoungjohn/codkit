/**
 * EVM adapter: viem transactions → policy `Action`s, simulation via `eth_call`,
 * and a guarded `send()` that runs the full policy pipeline.
 *
 * Import from `@codkit/policy/evm`; the core entry point never loads viem.
 */
import { decodeFunctionData, erc20Abi, type Abi, type Address, type Hex } from "viem";
import type { ExecuteResult, PolicyEngine } from "../engine.js";
import type { Action, SimulationResult, Spend } from "../types.js";

export interface EvmTx {
  to: Address;
  value?: bigint;
  data?: Hex;
}

/** The subset of a viem `PublicClient` the adapter needs. */
export interface EvmReader {
  call(args: { account?: Address; to: Address; value?: bigint; data?: Hex }): Promise<{ data?: Hex | undefined }>;
  estimateGas(args: { account: Address; to: Address; value?: bigint; data?: Hex }): Promise<bigint>;
}

/** The subset of a viem `WalletClient` (created with `account` and `chain`) the adapter needs. */
export interface EvmSender {
  sendTransaction(args: { to: Address; value?: bigint; data?: Hex }): Promise<Hex>;
}

export const evmChainId = (chainId: number): string => `eip155:${chainId}`;

export interface ToActionOptions {
  chainId: number;
  /** Extra ABIs used to name the method on non-ERC20 calls (otherwise the 4-byte selector is used). */
  abis?: Abi[];
}

/**
 * Translate an EVM transaction into an `Action`.
 *
 * - Plain value transfer → `transfer`, spend in `native`.
 * - ERC20 `transfer` / `transferFrom` / `approve` → spend in the token, `to` is the
 *   recipient (or spender). Approvals count as spend: an unlimited approval will
 *   blow through any cap, which is what you want.
 * - Anything else → `contract_call`; only the native `value` is visible as spend,
 *   so restrict such calls with `allow.programs` / `allow.methods`.
 */
export function evmTxToAction(tx: EvmTx, opts: ToActionOptions): Action {
  const chain = evmChainId(opts.chainId);
  const value = tx.value ?? 0n;
  const spends: Spend[] = value > 0n ? [{ asset: "native", amount: value }] : [];
  const data = tx.data && tx.data !== "0x" ? tx.data : undefined;

  if (!data) {
    return { chain, kind: "transfer", to: tx.to, spends, meta: { tx: serialise(tx) } };
  }

  const erc20 = tryDecode(erc20Abi, data);
  if (erc20) {
    const args = erc20.args as readonly unknown[];
    let recipient: string | undefined;
    let amount: bigint | undefined;
    if (erc20.functionName === "transfer" || erc20.functionName === "approve") {
      recipient = args[0] as Address;
      amount = args[1] as bigint;
    } else if (erc20.functionName === "transferFrom") {
      recipient = args[1] as Address;
      amount = args[2] as bigint;
    }
    if (recipient !== undefined && amount !== undefined) {
      return {
        chain,
        kind: erc20.functionName === "approve" ? "token_approval" : "token_transfer",
        to: recipient,
        program: tx.to,
        method: erc20.functionName,
        spends: [...spends, { asset: tx.to, amount }],
        meta: { tx: serialise(tx) },
      };
    }
  }

  let method: string = data.slice(0, 10);
  for (const abi of opts.abis ?? []) {
    const decoded = tryDecode(abi, data);
    if (decoded) {
      method = decoded.functionName;
      break;
    }
  }
  return { chain, kind: "contract_call", to: tx.to, program: tx.to, method, spends, meta: { tx: serialise(tx) } };
}

/** Dry-run with `eth_call` + `eth_estimateGas` from the agent's address. Never throws. */
export async function simulateEvmTx(reader: EvmReader, account: Address, tx: EvmTx): Promise<SimulationResult> {
  const args = { account, to: tx.to, ...(tx.value !== undefined && { value: tx.value }), ...(tx.data && { data: tx.data }) };
  try {
    const res = await reader.call(args);
    const gas = await reader.estimateGas(args);
    return { ok: true, details: { returnData: res.data ?? "0x", gasEstimate: gas.toString() } };
  } catch (e) {
    return { ok: false, error: revertMessage(e) };
  }
}

export interface EvmGuardOptions extends ToActionOptions {
  engine: PolicyEngine;
  account: Address;
  reader: EvmReader;
  sender?: EvmSender;
}

export interface EvmGuard {
  toAction(tx: EvmTx): Action;
  simulate(tx: EvmTx): Promise<SimulationResult>;
  /** evaluate → reserve → simulate → approve → send → commit (tx hash as ref). */
  send(tx: EvmTx): Promise<ExecuteResult<Hex>>;
}

export function createEvmGuard(opts: EvmGuardOptions): EvmGuard {
  const { engine, account, reader, sender } = opts;
  const toAction = (tx: EvmTx) => evmTxToAction(tx, opts);
  const simulate = (tx: EvmTx) => simulateEvmTx(reader, account, tx);
  return {
    toAction,
    simulate,
    send: (tx) => {
      if (!sender) throw new Error("createEvmGuard: no sender configured");
      return engine.execute(toAction(tx), {
        simulate: () => simulate(tx),
        execute: () =>
          sender.sendTransaction({ to: tx.to, ...(tx.value !== undefined && { value: tx.value }), ...(tx.data && { data: tx.data }) }),
        ref: (hash) => hash,
      });
    },
  };
}

/** Explorer link for common testnets/mainnets; falls back to Blockscout-style path on `baseUrl`. */
export function evmExplorerTxUrl(chainId: number, hash: Hex, baseUrl?: string): string | undefined {
  const known: Record<number, string> = {
    1: "https://etherscan.io",
    11155111: "https://sepolia.etherscan.io",
    8453: "https://basescan.org",
    84532: "https://sepolia.basescan.org",
    10: "https://optimistic.etherscan.io",
    11155420: "https://sepolia-optimism.etherscan.io",
    42161: "https://arbiscan.io",
    421614: "https://sepolia.arbiscan.io",
    137: "https://polygonscan.com",
    80002: "https://amoy.polygonscan.com",
  };
  const base = baseUrl ?? known[chainId];
  return base ? `${base.replace(/\/$/, "")}/tx/${hash}` : undefined;
}

function tryDecode(abi: Abi, data: Hex) {
  try {
    return decodeFunctionData({ abi, data });
  } catch {
    return undefined;
  }
}

function serialise(tx: EvmTx) {
  return { to: tx.to, value: (tx.value ?? 0n).toString(), data: tx.data ?? "0x" };
}

function revertMessage(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as { shortMessage?: unknown; message?: unknown };
    if (typeof o.shortMessage === "string") return o.shortMessage;
    if (typeof o.message === "string") return o.message;
  }
  return String(e);
}
