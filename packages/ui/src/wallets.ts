import type { WalletEcosystem } from "@codkit/wallet";

/** A wallet to suggest when it isn't installed: an install page, and on mobile a link that opens the dapp inside the wallet's app. */
export interface WalletSuggestion {
  name: string;
  ecosystems: WalletEcosystem[];
  /** Official download / install page. */
  install: string;
  /** Builds the wallet's "open this page in the in-app browser" link (mobile). */
  openIn?: (pageUrl: string) => string;
}

const enc = encodeURIComponent;
const origin = (pageUrl: string) => new URL(pageUrl).origin;

/**
 * Wallets offered when not installed. Every URL below comes from the wallet's own site or docs
 * (checked 2026-11-20). Add a wallet only with an official source for its links.
 */
export const suggestedWallets: readonly WalletSuggestion[] = [
  {
    name: "MetaMask",
    ecosystems: ["evm"],
    install: "https://metamask.com/download/", // metamask.io/download redirects here
    // docs.metamask.io/metamask-connect/evm/guides/metamask-exclusive/use-deeplinks — example takes the URL without the protocol
    openIn: (url) => `https://link.metamask.io/dapp/${url.replace(/^https?:\/\//, "")}`,
  },
  { name: "Coinbase Wallet", ecosystems: ["evm"], install: "https://wallet.coinbase.com/" },
  { name: "Trust Wallet", ecosystems: ["evm"], install: "https://trustwallet.com/download" },
  { name: "Rabby", ecosystems: ["evm"], install: "https://rabby.io/" },
  {
    name: "Phantom",
    ecosystems: ["solana"],
    install: "https://phantom.com/download",
    // docs.phantom.com/phantom-deeplinks/other-methods/browse
    openIn: (url) => `https://phantom.com/ul/browse/${enc(url)}?ref=${enc(origin(url))}`,
  },
  {
    name: "Solflare",
    ecosystems: ["solana"],
    install: "https://solflare.com/download",
    // docs.solflare.com/solflare/technical/deeplinks/other-methods/browse
    openIn: (url) => `https://solflare.com/ul/v1/browse/${enc(url)}?ref=${enc(origin(url))}`,
  },
  {
    name: "Backpack",
    ecosystems: ["solana"],
    install: "https://backpack.app/download",
    // docs.backpack.app/deeplinks/other-methods/browse
    openIn: (url) => `https://backpack.app/ul/v1/browse/${enc(url)}?ref=${enc(origin(url))}`,
  },
];

/** "Rabby Wallet" ≈ "Rabby", "Trust Wallet" ≈ "Trust": compare names without the word "wallet". */
export const sameWallet = (a: string, b: string) => {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\bwallet\b/g, "")
      .replace(/[^a-z0-9]/g, "");
  return norm(a) === norm(b);
};
