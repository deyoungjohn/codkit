import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

// Anvil's well-known dev keys — public, local chain only.
export const KEYS = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  client: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  provider: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  arbiter: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
} as const satisfies Record<string, Hex>;

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.listen(0, () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });

export async function startAnvil(): Promise<{ url: string; stop: () => void; publicClient: PublicClient }> {
  const port = await freePort();
  const proc: ChildProcess = spawn("anvil", ["--port", String(port), "--silent"], { stdio: "ignore" });
  const url = `http://127.0.0.1:${port}`;
  const publicClient = createPublicClient({ chain: foundry, transport: http(url) });
  for (let i = 0; i < 100; i++) {
    try {
      await publicClient.getChainId();
      return { url, stop: () => proc.kill(), publicClient };
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  proc.kill();
  throw new Error("anvil did not start (is Foundry installed?)");
}

export function wallet(url: string, key: Hex) {
  return createWalletClient({ account: privateKeyToAccount(key), chain: foundry, transport: http(url) });
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), "../evm/out");

/** Load a Foundry artifact (run `forge build --root evm` first). */
export function artifact(file: string, name: string): { abi: Abi; bytecode: Hex } {
  const a = JSON.parse(readFileSync(join(outDir, file, `${name}.json`), "utf8"));
  return { abi: a.abi, bytecode: a.bytecode.object };
}

export async function deployed(publicClient: PublicClient, hash: Hex): Promise<Address> {
  const r = await publicClient.waitForTransactionReceipt({ hash });
  if (!r.contractAddress) throw new Error("no contract address");
  return r.contractAddress;
}
