import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { getBase58Decoder, getBase64Encoder, getSignatureFromTransaction, getTransactionDecoder } from "@solana/kit";

const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** SPL token account bytes (165): the amount sits at offset 64, little-endian. */
export const tokenAccountData = (amount: bigint) => {
  const b = new Uint8Array(165);
  new DataView(b.buffer).setBigUint64(64, amount, true);
  return Buffer.from(b).toString("base64");
};
export const account = (lamports: bigint | number, data = "", owner = "11111111111111111111111111111111") => ({
  data: [data, "base64"],
  executable: false,
  lamports: Number(lamports),
  owner,
  rentEpoch: 0,
  space: data.length,
});

export interface Sim {
  err?: unknown;
  logs?: string[];
  /** Post-simulation state of the requested accounts, in order. */
  accounts?: (ReturnType<typeof account> | null)[];
}

/** A Solana JSON-RPC stub with state the test can change; records every transaction sent. */
export async function startStubRpc() {
  const state = {
    lamports: 5_000_000_000n,
    tokenBalances: {} as Record<string, bigint>, // by token account address
    mintOwners: {} as Record<string, string>, // by mint; default: legacy Token
    simulate: (_wire: string, _accounts?: string[]): Sim => ({}),
    /** What getMultipleAccounts returns, per call (the last entry repeats). */
    multipleAccounts: [] as (ReturnType<typeof account> | null)[][],
    status: (_sig: string): { err: unknown } | { confirmationStatus: string } | null => ({ confirmationStatus: "confirmed" }),
    sent: [] as string[],
    calls: [] as string[],
  };
  const blockhash = getBase58Decoder().decode(crypto.getRandomValues(new Uint8Array(32)));
  let multi = 0;
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { id, method, params } = JSON.parse(body);
      state.calls.push(method);
      const context = { slot: 100 };
      let result: unknown;
      let error: { code: number; message: string } | undefined;
      switch (method) {
        case "getBalance":
          result = { context, value: Number(state.lamports) };
          break;
        case "getTokenAccountBalance": {
          const amt = state.tokenBalances[params[0]];
          if (amt === undefined) error = { code: -32602, message: "Invalid param: could not find account" };
          else
            result = {
              context,
              value: { amount: amt.toString(), decimals: 6, uiAmount: Number(amt) / 1e6, uiAmountString: String(Number(amt) / 1e6) },
            };
          break;
        }
        case "getAccountInfo":
          result = { context, value: account(1_461_600, "", state.mintOwners[params[0]] ?? TOKEN) };
          break;
        case "getLatestBlockhash":
          result = { context, value: { blockhash, lastValidBlockHeight: 1000 } };
          break;
        case "simulateTransaction": {
          const sim = state.simulate(params[0], params[1]?.accounts?.addresses);
          result = {
            context,
            value: { err: sim.err ?? null, logs: sim.logs ?? [], accounts: sim.accounts ?? null, unitsConsumed: 1234, returnData: null },
          };
          break;
        }
        case "getMultipleAccounts": {
          const list = state.multipleAccounts[Math.min(multi++, state.multipleAccounts.length - 1)] ?? params[0].map(() => null);
          result = { context, value: list };
          break;
        }
        case "sendTransaction": {
          state.sent.push(params[0]);
          result = getSignatureFromTransaction(getTransactionDecoder().decode(getBase64Encoder().encode(params[0])) as never);
          break;
        }
        case "getSignatureStatuses":
          result = {
            context,
            value: (params[0] as string[]).map((s) => {
              const st = state.status(s);
              return st
                ? {
                    slot: 100,
                    confirmations: 1,
                    err: "err" in st ? st.err : null,
                    confirmationStatus: "confirmationStatus" in st ? st.confirmationStatus : "confirmed",
                    status: {},
                  }
                : null;
            }),
          };
          break;
        default:
          error = { code: -32601, message: `stub: ${method} not implemented` };
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(error ? { jsonrpc: "2.0", id, error } : { jsonrpc: "2.0", id, result }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    state,
    resetMulti: () => (multi = 0),
    close: () => server.close(),
  };
}
