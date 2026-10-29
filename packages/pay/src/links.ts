/**
 * Plain USDC payments: payment links, QR codes, and transfer transactions.
 * Import from `@codkit/pay/links`. No chain SDK: the links are standard URIs
 * (EIP-681 on EVM, Solana Pay on Solana) that any wallet can open or scan.
 */
import { renderSVG } from "uqr";

/** Circle USDC by CAIP-2 chain id. */
export const USDC: Readonly<Record<string, string>> = {
  "eip155:1": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "eip155:11155111": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "eip155:10": "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  "eip155:11155420": "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
  "eip155:42161": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  "eip155:421614": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  "eip155:137": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  "eip155:80002": "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "EPjFWdvwXcSi2HvXqrJ6Q1PBdB3Ksdmvt1RZTZhzQpVM",
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
};

export function usdcAddress(chain: string): string {
  const a = USDC[chain];
  if (!a) throw new Error(`no known USDC address for ${chain}; pass \`asset\` explicitly`);
  return a;
}

export interface PaymentRequest {
  /** CAIP-2 chain id: `eip155:84532`, `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`, … */
  chain: string;
  /** Recipient address. */
  to: string;
  /** Atomic units (USDC has 6 decimals: `usdc("1.50")` from `@codkit/policy`). */
  amount: bigint;
  /** Token address / mint, `"native"`, or omit for USDC on `chain`. */
  asset?: string;
  /** Token decimals, used for Solana Pay's decimal amount. Default 6 (USDC). */
  decimals?: number;
  /** Solana Pay: shown by the wallet. */
  label?: string;
  message?: string;
  memo?: string;
  /** Solana Pay: base58 public key(s) added to the transfer so you can find it onchain. */
  reference?: string | string[];
}

/**
 * A wallet-openable payment URI.
 *
 * - EVM → EIP-681: `ethereum:<usdc>@84532/transfer?address=<to>&uint256=<amount>`
 * - Solana → Solana Pay: `solana:<to>?amount=1.5&spl-token=<mint>&reference=…`
 */
export function paymentLink(req: PaymentRequest): string {
  if (req.amount < 0n) throw new Error("amount must be non-negative");
  const [ns, ref] = req.chain.split(":");
  const asset = req.asset ?? usdcAddress(req.chain);
  if (ns === "eip155") {
    if (asset === "native") return `ethereum:${req.to}@${ref}?value=${req.amount}`;
    return `ethereum:${asset}@${ref}/transfer?address=${req.to}&uint256=${req.amount}`;
  }
  if (ns === "solana") {
    const q = new URLSearchParams();
    q.set("amount", toDecimal(req.amount, asset === "native" ? 9 : (req.decimals ?? 6)));
    if (asset !== "native") q.set("spl-token", asset);
    for (const r of [req.reference ?? []].flat()) q.append("reference", r);
    if (req.label) q.set("label", req.label);
    if (req.message) q.set("message", req.message);
    if (req.memo) q.set("memo", req.memo);
    return `solana:${req.to}?${q.toString().replaceAll("+", "%20")}`;
  }
  throw new Error(`payment links are not supported for ${req.chain}`);
}

/** An SVG QR code for a payment request (or any URI). */
export function paymentQrSvg(req: PaymentRequest | string, opts: { pixelSize?: number; border?: number } = {}): string {
  return renderSVG(typeof req === "string" ? req : paymentLink(req), { ecc: "M", ...opts });
}

/**
 * An ERC-20 `transfer` tx for USDC (or `asset`) on an EVM chain. Send it through
 * `createEvmGuard(...).send(tx)` from `@codkit/policy/evm`, so caps, simulation
 * and approval apply.
 */
export function usdcTransferTx(req: Pick<PaymentRequest, "chain" | "to" | "amount" | "asset">): { to: `0x${string}`; data: `0x${string}` } {
  if (!req.chain.startsWith("eip155:")) throw new Error(`usdcTransferTx is EVM-only, got ${req.chain}`);
  if (!/^0x[0-9a-fA-F]{40}$/.test(req.to)) throw new Error(`invalid recipient ${req.to}`);
  if (req.amount < 0n || req.amount >= 2n ** 256n) throw new Error("amount out of range");
  const token = req.asset ?? usdcAddress(req.chain);
  const word = (hex: string) => hex.padStart(64, "0");
  return { to: token as `0x${string}`, data: `0xa9059cbb${word(req.to.slice(2).toLowerCase())}${word(req.amount.toString(16))}` };
}

function toDecimal(atomic: bigint, decimals: number): string {
  const s = atomic.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
