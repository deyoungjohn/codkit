// Runs in the page before the app. Thin wallet shims; every request goes to the Node test
// process (window.__codkitEvm / __codkitSolana, from Playwright's exposeFunction).
(() => {
  const icon =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxIDEnPjxyZWN0IHdpZHRoPScxJyBoZWlnaHQ9JzEnIGZpbGw9JyMzYjViZGInLz48L3N2Zz4=";

  // EIP-6963 provider
  const provider = {
    request: ({ method, params }) => window.__codkitEvm(method, params ?? []),
    on: () => {},
    removeListener: () => {},
  };
  const detail = Object.freeze({ info: { uuid: crypto.randomUUID(), name: "Codkit Test EVM", icon, rdns: "dev.codkit.test" }, provider });
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();

  // Wallet Standard wallet
  const b64 = (u) => btoa(String.fromCharCode(...u));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const chains = ["solana:devnet", "solana:mainnet", "solana:testnet"];
  let account;
  const wallet = {
    version: "1.0.0",
    name: "Codkit Test Solana",
    icon,
    chains,
    get accounts() {
      return account ? [account] : [];
    },
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async () => {
          account ??= { address: await window.__codkitSolana("address", {}), publicKey: new Uint8Array(32), chains, features: [] };
          return { accounts: [account] };
        },
      },
      "standard:disconnect": {
        version: "1.0.0",
        disconnect: async () => {
          account = undefined;
        },
      },
      "standard:events": { version: "1.0.0", on: () => () => {} },
      "solana:signMessage": {
        version: "1.0.0",
        signMessage: async (...inputs) =>
          Promise.all(
            inputs.map(async (i) => ({
              signedMessage: i.message,
              signature: unb64(await window.__codkitSolana("signMessage", { message: b64(i.message) })),
            })),
          ),
      },
      "solana:signAndSendTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: [0],
        signAndSendTransaction: async (...inputs) =>
          Promise.all(
            inputs.map(async (i) => ({
              signature: unb64(await window.__codkitSolana("signAndSend", { transaction: b64(i.transaction), chain: i.chain })),
            })),
          ),
      },
    },
  };
  const register = (api) => api.register(wallet);
  window.addEventListener("wallet-standard:app-ready", (e) => register(e.detail));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
})();
