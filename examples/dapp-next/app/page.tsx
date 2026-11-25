import { ChainSwitcher, ConnectButton } from "@codkit/ui";
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
    </main>
  );
}
