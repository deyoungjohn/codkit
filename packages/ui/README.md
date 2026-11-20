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

| Component                        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ConnectButton`                  | Native `<dialog>` picker; shows each wallet's own icon; reports wallet errors (e.g. a rejected request) inline. `ecosystems={["evm"]}` limits it.                                                                                                                                                                                                                                                                                                   |
| `ConnectButton` `suggestions`    | Wallets offered when not installed: a "Get a wallet" section with official install links on desktop, and "Open in …" links on phones (they reopen the page in the wallet app's browser). Default `suggestedWallets`: MetaMask, Coinbase Wallet, Trust Wallet, Rabby (EVM); Phantom, Solflare, Backpack (Solana), each link from the wallet's own docs. Add yours with `[...suggestedWallets, { name, ecosystems, install, openIn }]`, or pass `[]`. |
| `AddressPill`                    | `0x1234…abcd` / `7xKX…sAsU`, click to copy, explorer link when given a `chain`.                                                                                                                                                                                                                                                                                                                                                                     |
| `ChainSwitcher`                  | A `<select>` over the adapter's chains; hidden when there's only one.                                                                                                                                                                                                                                                                                                                                                                               |
| `TokenAmountInput`               | Decimal text in, exact `bigint` atomic units out (no floats); rejects extra decimals, flags amounts above `max`, Max button.                                                                                                                                                                                                                                                                                                                        |
| `TxToastProvider` / `useTxToast` | `track(ecosystem, txId, label)` shows pending → confirmed / failed with an explorer link; resolves `true` when confirmed.                                                                                                                                                                                                                                                                                                                           |

Also exported: `parseAmount`, `formatAmount`, `shortAddress`.

## Styling

`styles.css` uses plain classes (`ck-*`) and CSS variables (`--ck-accent`, `--ck-radius`, `--ck-bg` …) with light and dark themes (`prefers-color-scheme`, or `data-theme` on `<html>`). Skip it and style the `ck-*` classes yourself, or pass `className`. No Tailwind required.
