import { ChainSwitcher, ConnectButton, TokenAmountInput, useTxToast } from "@codkit/ui";
import { useWallet, type WalletEcosystem } from "@codkit/wallet";
import { getTransferSolInstruction } from "@solana-program/system";
import { address, createNoopSigner } from "@solana/kit";
import { useState } from "react";

export function App() {
  return (
    <main>
      <header>
        <h1>codkit dapp</h1>
        <ConnectButton />
      </header>
      <div className="grid">
        <Panel ecosystem="evm" />
        <Panel ecosystem="solana" />
      </div>
    </main>
  );
}

function Panel({ ecosystem }: { ecosystem: WalletEcosystem }) {
  const wallet = useWallet(ecosystem);
  const track = useTxToast();
  const [signature, setSignature] = useState<string>();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState<bigint>();
  const [error, setError] = useState<string>();
  const decimals = wallet.chain.nativeCurrency.decimals;
  const connected = wallet.status === "connected";

  const act = async (fn: () => Promise<void>) => {
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const send = () =>
    act(async () => {
      if (!amount) throw new Error("Enter an amount");
      const id =
        wallet.ecosystem === "evm"
          ? await wallet.sendTransaction({ to: to as `0x${string}`, value: amount })
          : await wallet.sendTransaction({
              instructions: [
                getTransferSolInstruction({ source: createNoopSigner(address(wallet.address!)), destination: address(to), amount }),
              ],
            });
      await track(wallet.ecosystem, id, `Send to ${to.slice(0, 6)}…`);
    });

  return (
    <section className="panel" aria-label={`${ecosystem} panel`}>
      <div className="row">
        <h2>{ecosystem === "evm" ? "EVM" : "Solana"}</h2>
        <ChainSwitcher ecosystem={ecosystem} />
      </div>
      <p className="muted" data-testid={`${ecosystem}-status`}>
        {connected ? `${wallet.wallet?.name} · ${wallet.chain.name}` : "Not connected"}
      </p>
      <button
        type="button"
        className="ck-button"
        disabled={!connected}
        onClick={() => act(async () => setSignature(await wallet.signMessage("Hello from codkit")))}
      >
        Sign message
      </button>
      {signature && (
        <p className="mono" data-testid={`${ecosystem}-signature`}>
          {signature}
        </p>
      )}
      <label className="field">
        Recipient
        <input value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder={ecosystem === "evm" ? "0x…" : "Base58 address"} />
      </label>
      <TokenAmountInput value={amount} onChange={setAmount} decimals={decimals} symbol={wallet.chain.nativeCurrency.symbol} />
      <button type="button" className="ck-button" disabled={!connected || !to || !amount} onClick={send}>
        Send
      </button>
      {error && (
        <p role="alert" className="ck-error">
          {error}
        </p>
      )}
    </section>
  );
}
