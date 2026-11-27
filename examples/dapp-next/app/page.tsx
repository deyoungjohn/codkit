import { ChainSwitcher, ConnectButton } from "@codkit/ui";
import { PayButton } from "@codkit/ui/pay";
import { Status } from "./status";

// A server component: the UI below is server-rendered, then hydrates on the client.
export default function Page() {
  return (
    <main>
      <header>
        <h1>
          codkit <span>dapp · Next.js</span>
        </h1>
        <ConnectButton />
      </header>
      <section className="card" aria-labelledby="wallets">
        <h2 id="wallets">Wallets</h2>
        <Status />
        <div>
          <ChainSwitcher ecosystem="evm" />
        </div>
      </section>
      <section className="card" aria-labelledby="x402">
        <h2 id="x402">Paid API (x402)</h2>
        <p className="note">
          <code>/api/paid/price</code> costs 0.001 USDC on Base Sepolia. The wallet signs a USDC authorization; the facilitator settles it
          and pays the gas. Capped at 0.01 USDC a request.
        </p>
        <PayButton url="/api/paid/price" label="Test x402 payment" />
      </section>
    </main>
  );
}
