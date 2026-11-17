import { createPublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  chains,
  defineChain,
  EnvError,
  envStem,
  explorerAddressUrl,
  explorerTxUrl,
  findChain,
  getChain,
  getRpcUrl,
  getRpcUrls,
  getWsUrls,
  listChains,
  parseEnv,
  redactRpcUrl,
  rpcEnvSchema,
} from "../src/index.js";
import { viemChain, viemTransport } from "../src/viem.js";

describe("registry", () => {
  it("has unique keys and ids, consistent EVM ids, and secure public endpoints", () => {
    const all = listChains();
    expect(new Set(all.map((c) => c.key)).size).toBe(all.length);
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
    for (const c of all) {
      if (c.ecosystem === "evm") expect(c.id).toBe(`eip155:${c.chainId}`);
      const local = /localnet|anvil/.test(c.key);
      for (const u of c.rpcUrls) expect(u).toMatch(local ? /^http:\/\/127\.0\.0\.1/ : /^https:\/\//);
    }
    expect(listChains({ ecosystem: "solana", testnet: false }).map((c) => c.key)).toEqual(["solana"]);
  });

  it("finds a chain by key, CAIP-2, Wallet Standard id or EVM chain id", () => {
    expect(getChain("base-sepolia")).toBe(chains["base-sepolia"]);
    expect(getChain("eip155:84532")).toBe(chains["base-sepolia"]);
    expect(getChain(84532)).toBe(chains["base-sepolia"]);
    expect(getChain("solana:devnet")).toBe(chains["solana-devnet"]);
    expect(getChain("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1").key).toBe("solana-devnet");
    expect(getChain("sui:testnet").name).toBe("Sui Testnet");
    expect(findChain("nope")).toBeUndefined();
    expect(() => getChain(999_999)).toThrow(/unknown chain 999999/);
  });

  it("validates custom chains and accepts them everywhere", () => {
    const mine = defineChain({
      key: "my-rollup",
      id: "eip155:424242",
      ecosystem: "evm",
      name: "My Rollup",
      testnet: true,
      chainId: 424242,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: ["https://rpc.my-rollup.dev"],
      explorer: { name: "Blockscout", url: "https://explorer.my-rollup.dev" },
    });
    expect(getRpcUrls(mine, { env: { MY_ROLLUP_RPC_URL: "https://private.example" } })).toEqual([
      "https://private.example",
      "https://rpc.my-rollup.dev",
    ]);
    expect(explorerTxUrl(mine, "0xabc")).toBe("https://explorer.my-rollup.dev/tx/0xabc");
    expect(() => defineChain({ ...mine, key: "My Rollup" })).toThrow(/kebab-case/);
    expect(() => defineChain({ ...mine, id: "eip155:1" })).toThrow(/eip155:<chainId>/);
  });
});

describe("RPC resolution", () => {
  it("falls back to public endpoints with no env", () => {
    expect(getRpcUrls("base-sepolia", { env: {} })).toEqual(["https://sepolia.base.org"]);
    expect(getRpcUrl("solana-devnet", { env: {} })).toBe("https://api.devnet.solana.com");
    expect(getRpcUrl("sui-testnet", { env: {} })).toBe("https://fullnode.testnet.sui.io:443");
  });

  it("orders override → keyed provider → public, and dedupes", () => {
    const env = { BASE_SEPOLIA_RPC_URL: "https://a.example, https://b.example", ALCHEMY_API_KEY: "k1" };
    expect(getRpcUrls("base-sepolia", { env })).toEqual([
      "https://a.example",
      "https://b.example",
      "https://base-sepolia.g.alchemy.com/v2/k1",
      "https://sepolia.base.org",
    ]);
    expect(getRpcUrls("base-sepolia", { env, public: false })).toHaveLength(3);
    expect(getRpcUrls("base-sepolia", { env: { BASE_SEPOLIA_RPC_URL: "https://sepolia.base.org" } })).toEqual(["https://sepolia.base.org"]);
  });

  it("prefers Helius on Solana and reads framework-prefixed variables", () => {
    const env = { VITE_HELIUS_API_KEY: "h", NEXT_PUBLIC_ALCHEMY_API_KEY: "a" };
    expect(getRpcUrls("solana-devnet", { env })).toEqual([
      "https://devnet.helius-rpc.com/?api-key=h",
      "https://solana-devnet.g.alchemy.com/v2/a",
      "https://api.devnet.solana.com",
    ]);
    expect(getRpcUrls("solana-devnet", { env, providers: ["alchemy"] })[0]).toContain("alchemy");
    // chains without a provider slug skip it
    expect(getRpcUrls("solana-testnet", { env })).toEqual(["https://api.testnet.solana.com"]);
  });

  it("derives Solana websockets from an overridden RPC", () => {
    expect(getWsUrls("solana-devnet", { env: { SOLANA_DEVNET_RPC_URL: "https://my.rpc/x" } })).toEqual([
      "wss://my.rpc/x",
      "wss://api.devnet.solana.com",
    ]);
    expect(getWsUrls("solana-devnet", { env: { HELIUS_API_KEY: "h" } })[0]).toBe("wss://devnet.helius-rpc.com/?api-key=h");
  });

  it("explains how to fix a chain with no endpoint", () => {
    expect(() => getRpcUrls("base-sepolia", { env: {}, public: false })).toThrow(/set BASE_SEPOLIA_RPC_URL/);
    expect(() => getWsUrls("base-sepolia", { env: {} })).toThrow(/set BASE_SEPOLIA_WS_URL/);
  });

  it("redacts keys in URLs", () => {
    expect(redactRpcUrl("https://base-sepolia.g.alchemy.com/v2/secret")).toBe("https://base-sepolia.g.alchemy.com/v2/<redacted>");
    expect(redactRpcUrl("https://devnet.helius-rpc.com/?api-key=secret")).toBe("https://devnet.helius-rpc.com/?api-key=<redacted>");
  });
});

describe("explorer links", () => {
  it("builds tx and address links per ecosystem", () => {
    expect(explorerTxUrl("base-sepolia", "0x1")).toBe("https://sepolia.basescan.org/tx/0x1");
    expect(explorerAddressUrl(1, "0xA")).toBe("https://etherscan.io/address/0xA");
    expect(explorerTxUrl("solana-devnet", "5sig")).toBe("https://explorer.solana.com/tx/5sig?cluster=devnet");
    expect(explorerTxUrl("solana", "5sig")).toBe("https://explorer.solana.com/tx/5sig");
    expect(explorerAddressUrl("sui-testnet", "0x2")).toBe("https://suiscan.xyz/testnet/account/0x2");
    expect(explorerTxUrl("sui-localnet", "x")).toBeUndefined();
  });
});

describe("env schema", () => {
  const schema = rpcEnvSchema(["base-sepolia", "solana-devnet"]);

  it("accepts a valid env and drops empty values", () => {
    const env = parseEnv(schema, {
      BASE_SEPOLIA_RPC_URL: "https://x.example",
      SOLANA_DEVNET_WS_URL: "",
      HELIUS_API_KEY: "h",
      OTHER: "kept out",
    });
    expect(env).toEqual({ BASE_SEPOLIA_RPC_URL: "https://x.example", HELIUS_API_KEY: "h" });
  });

  it("reports every bad variable without echoing values", () => {
    try {
      parseEnv(schema, { BASE_SEPOLIA_RPC_URL: "not-a-url-secret", WALLETCONNECT_PROJECT_ID: "short" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      const err = e as EnvError;
      expect(err.issues.map((i) => i.name).sort()).toEqual(["BASE_SEPOLIA_RPC_URL", "WALLETCONNECT_PROJECT_ID"]);
      expect(err.message).not.toContain("not-a-url-secret");
    }
  });

  it("supports a prefix and extension with app variables", () => {
    const s = rpcEnvSchema(["base-sepolia"], { prefix: "NEXT_PUBLIC_" }).extend({ DATABASE_URL: z.url() });
    expect(Object.keys(s.shape)).toContain("NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL");
    expect(() => parseEnv(s, {})).toThrow(/DATABASE_URL/);
    expect(envStem("solana-devnet")).toBe("SOLANA_DEVNET");
  });
});

describe("viem glue", () => {
  it("builds a viem chain and a fallback transport from resolved RPCs", () => {
    const env = { BASE_SEPOLIA_RPC_URL: "https://a.example" };
    const chain = viemChain("base-sepolia", { env });
    expect(chain).toMatchObject({ id: 84532, name: "Base Sepolia", testnet: true });
    expect(chain.rpcUrls.default.http).toEqual(["https://a.example", "https://sepolia.base.org"]);
    const client = createPublicClient({ chain, transport: viemTransport("base-sepolia", { env }) });
    expect(client.transport.type).toBe("fallback");
    expect(createPublicClient({ chain, transport: viemTransport("base-sepolia", { env: {} }) }).transport.type).toBe("http");
    expect(() => viemChain("solana-devnet")).toThrow(/not an EVM chain/);
  });
});
