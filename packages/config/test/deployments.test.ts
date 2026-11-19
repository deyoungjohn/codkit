import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contractAddress, findDeployment, parseDeployment } from "../src/index.js";

// codkit's own records, written by its deploy scripts (local rehearsals are git-ignored, so CI sees the public ones)
const dir = join(import.meta.dirname, "../../contracts/deployments");
const records = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => parseDeployment(JSON.parse(readFileSync(join(dir, f), "utf8"))));

describe("deployments", () => {
  it("parses every codkit deployment record, on all three ecosystems", () => {
    expect(records.length).toBeGreaterThanOrEqual(3);
    expect(contractAddress(records, "base-sepolia", "Escrow")).toBe("0xb32ea9219afc9ba5e77db9fd414d5a4a8746c023");
    expect(contractAddress(records, 84532, "Reputation")).toMatch(/^0x[0-9a-f]{40}$/);
    expect(contractAddress(records, "solana:devnet", "kit_escrow")).toBe("8kQBzMWRWAEssN4wtBzrH4G8fHtbhrbHs9e24V2jWMkX");
    expect(contractAddress(records, "sui-testnet", "kit_escrow")).toMatch(/^0x9bc0/);
    // extra fields survive parsing
    expect(findDeployment(records, "solana-devnet")).toMatchObject({
      programId: "8kQBzMWRWAEssN4wtBzrH4G8fHtbhrbHs9e24V2jWMkX",
      upgradeAuthority: expect.any(String),
    });
  });

  it("reads what DeploymentRecorder.sol writes", () => {
    const fromForge = parseDeployment({
      chain: "eip155:84532",
      contracts: { Shop: { address: "0x00000000000000000000000000000000000000aa" } },
    });
    expect(contractAddress(fromForge, "base-sepolia", "Shop")).toBe("0x00000000000000000000000000000000000000aa");
  });

  it("names what exists when a lookup misses", () => {
    expect(() => contractAddress(records, "base-sepolia", "Nope")).toThrow(
      /Nope is not deployed on base-sepolia \(have: Reputation, Escrow, ReceiptAnchor\)/,
    );
    expect(() => contractAddress(records, "optimism", "Escrow")).toThrow(/no deployment for optimism \(have: .*base-sepolia/);
  });

  it("rejects malformed records with every problem listed", () => {
    expect(() => parseDeployment({ chain: "eip155:999999999", contracts: {} })).toThrow(
      /chain: unknown chain[\s\S]*contracts: no contracts/,
    );
    expect(() => parseDeployment({ chain: "base-sepolia", contracts: { Escrow: {} } })).toThrow(/contracts\.Escrow\.address/);
  });
});
