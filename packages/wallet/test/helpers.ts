import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { connect, createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { getBase58Decoder, getCompiledTransactionMessageDecoder, getTransactionDecoder, type KeyPairSigner, signBytes } from "@solana/kit";
import type { Wallet, WalletAccount } from "@wallet-standard/base";

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.listen(0, () => {
      const port = (s.address() as AddressInfo).port;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });

/** Anvil on a free port; its dev accounts are unlocked, so wagmi's mock connector can send through it. */
export async function startAnvil() {
  const port = await freePort();
  const proc = spawn("anvil", ["--port", String(port), "--silent"], { stdio: "ignore" });
  const url = `http://127.0.0.1:${port}`;
  // probe the port over TCP: under happy-dom, `fetch` logs every refused connection while anvil boots
  const open = () =>
    new Promise<boolean>((resolve) => {
      const sock = connect(port, "127.0.0.1", () => {
        sock.end();
        resolve(true);
      });
      sock.on("error", () => resolve(false));
    });
  for (let i = 0; i < 100; i++) {
    if (await open()) return { url, stop: () => proc.kill() };
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error("anvil did not start (is Foundry installed?)");
}

/** Solana JSON-RPC stub: a blockhash, and signature statuses for whatever was "sent". */
export async function fakeSolanaRpc(opts: { failed?: Set<string> } = {}) {
  const blockhash = getBase58Decoder().decode(crypto.getRandomValues(new Uint8Array(32)));
  const server = createHttpServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { id, method, params } = JSON.parse(body);
      const context = { slot: 1 };
      const result =
        method === "getLatestBlockhash"
          ? { context, value: { blockhash, lastValidBlockHeight: 100 } }
          : method === "getSignatureStatuses"
            ? {
                context,
                value: (params[0] as string[]).map((s) =>
                  opts.failed?.has(s)
                    ? {
                        slot: 1,
                        confirmations: 0,
                        err: { InstructionError: [0, "Custom"] },
                        confirmationStatus: "confirmed",
                        status: { Err: {} },
                      }
                    : { slot: 1, confirmations: 1, err: null, confirmationStatus: "confirmed", status: { Ok: null } },
                ),
              }
            : undefined;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(result ? { jsonrpc: "2.0", id, result } : { jsonrpc: "2.0", id, error: { code: -32601, message: method } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, blockhash, close: () => server.close() };
}

/** A Wallet Standard wallet backed by a real keypair; records what it was asked to sign. */
export function fakeSolanaWallet(signer: KeyPairSigner, opts: { name?: string; sendFeature?: boolean } = {}) {
  const account: WalletAccount = {
    address: signer.address,
    publicKey: new Uint8Array(32),
    chains: ["solana:devnet", "solana:mainnet"],
    features: ["solana:signMessage", "solana:signAndSendTransaction"],
  };
  const listeners = new Set<(p: { accounts?: readonly WalletAccount[] }) => void>();
  const sent: { feePayer: string; blockhash: string; programs: string[]; chain: string }[] = [];
  const connects: { silent: boolean }[] = [];
  let connected = false;
  const sign = async (bytes: Uint8Array) => new Uint8Array(await signBytes(signer.keyPair.privateKey, bytes));
  const decode = (wire: Uint8Array) => {
    const tx = getTransactionDecoder().decode(wire);
    const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
    return { tx, msg };
  };
  const wallet: Wallet = {
    version: "1.0.0",
    name: opts.name ?? "Test Wallet",
    icon: "data:image/svg+xml;base64,PHN2Zy8+",
    chains: ["solana:devnet", "solana:mainnet"],
    get accounts() {
      return connected ? [account] : [];
    },
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async (input?: { silent?: boolean }) => {
          connects.push({ silent: !!input?.silent });
          connected = true;
          return { accounts: [account] };
        },
      },
      "standard:disconnect": {
        version: "1.0.0",
        disconnect: async () => {
          connected = false;
        },
      },
      "standard:events": {
        version: "1.0.0",
        on: (_e: string, l: (p: { accounts?: readonly WalletAccount[] }) => void) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
      },
      "solana:signMessage": {
        version: "1.0.0",
        signMessage: async (...inputs: { message: Uint8Array }[]) =>
          Promise.all(inputs.map(async (i) => ({ signedMessage: i.message, signature: await sign(i.message) }))),
      },
      ...(opts.sendFeature !== false && {
        "solana:signAndSendTransaction": {
          version: "1.0.0",
          supportedTransactionVersions: [0],
          signAndSendTransaction: async (...inputs: { transaction: Uint8Array; chain: string }[]) =>
            Promise.all(
              inputs.map(async (i) => {
                const { tx, msg } = decode(i.transaction);
                const keys = msg.staticAccounts;
                sent.push({
                  feePayer: keys[0]!,
                  blockhash: msg.lifetimeToken,
                  programs: (msg as unknown as { instructions: { programAddressIndex: number }[] }).instructions.map(
                    (ix) => keys[ix.programAddressIndex]!,
                  ),
                  chain: i.chain,
                });
                return { signature: await sign(new Uint8Array(tx.messageBytes)) };
              }),
            ),
        },
      }),
    },
  };
  return {
    wallet,
    sent,
    connects,
    /** Simulate the user switching accounts or disconnecting inside the wallet. */
    emit: (accounts: readonly WalletAccount[]) => {
      for (const l of listeners) l({ accounts });
    },
  };
}

/** Announce a wallet the way real wallets do. */
export function registerWallet(wallet: Wallet) {
  window.dispatchEvent(
    new CustomEvent("wallet-standard:register-wallet", { detail: ({ register }: { register: (w: Wallet) => void }) => register(wallet) }),
  );
}
