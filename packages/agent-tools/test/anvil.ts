import { spawn } from "node:child_process";
import { connect, createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { createPublicClient, createWalletClient, type Hex, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

// Anvil's well-known dev keys: public, local chain only.
export const KEYS = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  agent: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
} as const satisfies Record<string, Hex>;
export const RECIPIENT = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const; // anvil account #2

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.listen(0, () => {
      const port = (s.address() as AddressInfo).port;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });

const up = (port: number) =>
  new Promise<boolean>((resolve) => {
    const sock = connect(port, "127.0.0.1", () => {
      sock.end();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
  });

export async function startAnvil() {
  const port = await freePort();
  const proc = spawn("anvil", ["--port", String(port), "--silent"], { stdio: "ignore" });
  for (let i = 0; i < 100 && !(await up(port)); i++) await new Promise((r) => setTimeout(r, 100));
  if (!(await up(port))) {
    proc.kill();
    throw new Error("anvil did not start (is Foundry installed?)");
  }
  const url = `http://127.0.0.1:${port}`;
  const publicClient = createPublicClient({ chain: foundry, transport: http(url), pollingInterval: 50 });
  const wallet = (key: Hex) =>
    createWalletClient({ account: privateKeyToAccount(key), chain: foundry, transport: http(url), pollingInterval: 50 });
  return { url, publicClient, deployer: wallet(KEYS.deployer), agent: wallet(KEYS.agent), stop: () => proc.kill() };
}
