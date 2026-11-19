import { ChainSwitcher, ConnectButton } from "@codkit/ui";
import { Status } from "./status";

// A server component: the UI below is server-rendered, then hydrates on the client.
export default function Page() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "24px 16px", display: "grid", gap: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 20 }}>codkit dapp · Next.js</h1>
        <ConnectButton />
      </header>
      <ChainSwitcher ecosystem="evm" />
      <Status />
    </main>
  );
}
