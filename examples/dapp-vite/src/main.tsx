import "@codkit/ui/styles.css";
import "./app.css";
import { TxToastProvider } from "@codkit/ui";
import { WalletProvider } from "@codkit/wallet";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { adapters } from "./wallets";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WalletProvider adapters={adapters}>
      <TxToastProvider>
        <App />
      </TxToastProvider>
    </WalletProvider>
  </StrictMode>,
);
