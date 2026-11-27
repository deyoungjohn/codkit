# @codkit/ui

Dapp components for [`@codkit/wallet`](../wallet): `ConnectButton`, `AddressPill`, `ChainSwitcher`, `TokenAmountInput`, `TxStatusToast`. Import them, or copy a file into your project and restyle it (each component is one self-contained file in `src/`).

```bash
npm install @codkit/ui @codkit/wallet @codkit/config
```

```tsx
import "@codkit/ui/styles.css"; // optional default theme
import { ChainSwitcher, ConnectButton, TokenAmountInput, TxToastProvider, useTxToast } from "@codkit/ui";

<WalletProvider adapters={adapters}>
  <TxToastProvider>
    <ConnectButton /> {/* wallet picker grouped by ecosystem; address pills once connected */}
    <ChainSwitcher ecosystem="evm" />
    <Send />
  </TxToastProvider>
</WalletProvider>;

function Send() {
  const evm = useWallet("evm");
  const track = useTxToast();
  const [amount, setAmount] = useState<bigint>();
  return (
    <>
      <TokenAmountInput value={amount} onChange={setAmount} decimals={6} symbol="USDC" max={balance} />
      <button onClick={async () => track("evm", await evm.sendTransaction(tx), "Send USDC")}>Send</button>
    </>
  );
}
```

| Component                        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ConnectButton`                  | Native `<dialog>` picker with one tab per ecosystem (arrow keys move between tabs). It closes once a wallet connects, shows each wallet's own icon and any error in plain words, and explains when a wallet kept the site connected after a disconnect. The wallet list takes the height it needs and scrolls only when the window is too short. `ecosystems={["evm"]}` limits it.                                                                                                                                             |
| `ConnectButton` `suggestions`    | Wallets offered when not installed, **only while fewer than `suggestBelow` (default 3) wallets are detected**: a "Get a wallet" section with official install links on desktop, and "Open in …" links on phones (they reopen the page in the wallet app's browser). Default `suggestedWallets`: MetaMask, Coinbase Wallet, Trust Wallet, Rabby (EVM); Phantom, Solflare, Backpack (Solana), each link from the wallet's own docs. Add yours with `[...suggestedWallets, { name, ecosystems, install, openIn }]`, or pass `[]`. |
| `AddressPill`                    | `0x1234…abcd` / `7xKX…sAsU`, click to copy, explorer link when given a `chain`.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `ChainSwitcher`                  | A `<select>` over the adapter's chains; hidden when there's only one.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `TokenAmountInput`               | Decimal text in, exact `bigint` atomic units out (no floats); rejects extra decimals, flags amounts above `max`, Max button.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `TxToastProvider` / `useTxToast` | `track(ecosystem, txId, label)` shows pending → confirmed / failed with an explorer link; resolves `true` when confirmed.                                                                                                                                                                                                                                                                                                                                                                                                      |

Also exported: `parseAmount`, `formatAmount`, `shortAddress`.

## Styling

`styles.css` uses plain classes (`ck-*`) and CSS variables (`--ck-accent`, `--ck-radius`, `--ck-bg` …) with light and dark themes (`prefers-color-scheme`, or `data-theme` on `<html>`). Skip it and style the `ck-*` classes yourself, or pass `className`. No Tailwind required. Helpers for your own screens: `ck-button-secondary` (the quiet companion to a primary button), `ck-field` (a labelled text input), and `--ck-raised` / `--ck-radius-lg` for one step up in surface and radius.

## Paid requests (x402): `@codkit/ui/pay`

`<PayButton>` requests a paid endpoint, pays its x402 price from the connected EVM wallet, and shows the settlement with an explorer link. The wallet signs a USDC transfer authorization (EIP-3009); the server's facilitator settles it and pays the gas. Every payment goes through a `@codkit/policy` engine before the wallet is asked to sign: by default at most 0.01 USDC a request and 10× that per page load, USDC only.

```tsx
import { PayButton, usePaidFetch } from "@codkit/ui/pay"; // needs @codkit/pay and @codkit/policy installed

<PayButton url="/api/paid/price" label="Test x402 payment" onResponse={async (res) => setData(await res.json())} />;

// or your own UI: a fetch that pays
const { fetch: paidFetch, ready } = usePaidFetch({ maxPerPayment: "0.05" });
```

Pass `engine` for your own limits (other assets, human approval, a kill switch). EVM only for now. The server side is `paywall()` from `@codkit/pay/hono` or `/express`. Checked end to end in a real browser: the Next example's e2e paid its own `/api/paid/price` through the public Base Sepolia facilitator.
