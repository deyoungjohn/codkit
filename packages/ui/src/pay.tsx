import { explorerTxUrl } from "@codkit/config";
import { createBudgetedFetch, type PaymentOutcome, registerExactEvmScheme, x402Client } from "@codkit/pay";
import { USDC } from "@codkit/pay/links";
import { createPolicyEngine, fromAtomic, type PolicyEngine, usdc } from "@codkit/policy";
import { useWallet } from "@codkit/wallet";
import { type ReactNode, useCallback, useState } from "react";
import { cx } from "./AddressPill.js";
import { AlertIcon, ArrowUpRightIcon, CheckIcon, SpinnerIcon } from "./icons.js";

export interface PaidFetchOptions {
  /** The most one request may cost, in USDC. Default "0.01". */
  maxPerPayment?: string;
  /** The most this page may spend in total (until reload), in USDC. Default 10 × `maxPerPayment`. */
  maxTotal?: string;
  /** Your own policy engine instead (other assets, approval, a kill switch). Replaces both limits. */
  engine?: PolicyEngine;
}

/** A USDC limit on every EVM chain `@codkit/pay` knows; any other asset is refused (the engine's default). */
function capEngine(maxPerPayment: string, maxTotal: string): PolicyEngine {
  const limits = Object.entries(USDC)
    .filter(([chain]) => chain.startsWith("eip155:"))
    .map(([chain, asset]) => ({ asset, chain, label: "USDC", decimals: 6, perTx: usdc(maxPerPayment), total: usdc(maxTotal) }));
  return createPolicyEngine({ policy: { limits } });
}

/**
 * `fetch` that pays x402 paywalls (HTTP 402) with the connected EVM wallet: the wallet signs a USDC transfer
 * authorization (EIP-3009) and the server's facilitator settles it, so the person pays no gas. Every payment is
 * checked against a policy engine before the wallet is asked to sign; by default at most 0.01 USDC a request.
 */
export function usePaidFetch(opts: PaidFetchOptions = {}) {
  const wallet = useWallet("evm");
  const max = opts.maxPerPayment ?? "0.01";
  const [engine] = useState(() => opts.engine ?? capEngine(max, opts.maxTotal ?? String(Number(max) * 10)));
  const [last, setLast] = useState<PaymentOutcome>();
  const ready = wallet.status === "connected" && !!wallet.address;

  /** Like `fetch`; `onPayment` hears how this call's payment went (settled, failed, or blocked by the policy). */
  const paidFetch = useCallback(
    (input: RequestInfo | URL, init?: RequestInit, onPayment?: (outcome: PaymentOutcome) => void): Promise<Response> => {
      if (!wallet.address) return Promise.reject(new Error("Connect a wallet to pay"));
      const client = new x402Client();
      registerExactEvmScheme(client, {
        signer: { address: wallet.address as `0x${string}`, signTypedData: (data) => wallet.signTypedData(data) },
      });
      const report = (o: PaymentOutcome) => {
        setLast(o);
        onPayment?.(o);
      };
      return createBudgetedFetch({ engine, client, onPayment: report })(input, init);
    },
    [wallet, engine],
  );
  return { fetch: paidFetch, ready, last, engine };
}

type State =
  | { status: "idle" }
  | { status: "paying" }
  | { status: "paid"; amount?: string; href?: string; free: boolean }
  | { status: "failed"; message: string };

export interface PayButtonProps extends PaidFetchOptions {
  /** The paid endpoint. */
  url: string;
  init?: RequestInit;
  label?: ReactNode;
  /** Called with the response once it succeeds, e.g. to show what was bought. */
  onResponse?: (res: Response) => void | Promise<void>;
  className?: string;
}

/**
 * One click: request a paid endpoint, pay its x402 price from the connected wallet (within the cap), show the
 * settlement with an explorer link. The quickest way to show judges a working agent-payment loop.
 */
export function PayButton({ url, init, label = "Pay", onResponse, className, ...opts }: PayButtonProps) {
  const { fetch: paidFetch, ready } = usePaidFetch(opts);
  const [state, setState] = useState<State>({ status: "idle" });

  const pay = async () => {
    setState({ status: "paying" });
    let outcome: PaymentOutcome | undefined;
    try {
      const res = await paidFetch(url, init, (o) => {
        outcome = o;
      });
      const o = outcome as PaymentOutcome | undefined;
      if (o?.status === "failed") throw new Error(`Payment not accepted: ${o.reason}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText || "request failed"}`.trim());
      await onResponse?.(res);
      if (o?.status === "settled") {
        const spend = o.action.spends[0];
        const chainId = Number(o.network.split(":")[1]);
        setState({
          status: "paid",
          free: false,
          ...(spend && { amount: `${fromAtomic(spend.amount, 6)} USDC` }),
          ...(chainId && { href: explorerTxUrl(chainId, o.transaction) }),
        });
      } else setState({ status: "paid", free: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setState({
        status: "failed",
        message: /policy:/.test(message) ? `Refused before signing: ${message.replace(/^.*policy:\s*/, "")}` : message,
      });
    }
  };

  return (
    <div className={cx("ck-pay", className)}>
      <button type="button" className="ck-button" disabled={!ready || state.status === "paying"} onClick={pay}>
        {state.status === "paying" ? "Paying…" : label}
      </button>
      <p className={cx("ck-pay-status", `ck-pay-${state.status}`)} role={state.status === "failed" ? "alert" : "status"}>
        {state.status === "idle" && !ready && "Connect a wallet to pay"}
        {state.status === "paying" && (
          <>
            <SpinnerIcon /> Confirm in your wallet
          </>
        )}
        {state.status === "paid" && (
          <>
            <CheckIcon /> {state.free ? "Done (no payment was asked for)" : `Paid${state.amount ? ` ${state.amount}` : ""}`}
            {state.href && (
              <a href={state.href} target="_blank" rel="noreferrer">
                View <ArrowUpRightIcon />
              </a>
            )}
          </>
        )}
        {state.status === "failed" && (
          <>
            <AlertIcon /> {state.message}
          </>
        )}
      </p>
    </div>
  );
}
