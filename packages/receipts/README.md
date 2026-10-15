# @iamyoungjohn-kit/receipts

Verifiable receipts for agent actions. Every action goes into an append-only log where each entry is **signed** and **hash-chained** to the one before it. Anchoring the latest hash onchain commits to the entire history. If anyone edits, drops, or reorders an entry, verification fails.

```
receipt #0 ─▶ #1 ─▶ #2 ─▶ … ─▶ #n            (each commits to the previous hash)
                                  │
         head hash + seq + uri ───┴──▶ onchain anchor (EVM event · Solana memo · Sui event)
         full log (JSONL) ────────────▶ Walrus / IPFS / anywhere
```

The core imports no chain SDK. Hashing is sha256 over canonical JSON, and signing defaults to ed25519 (via `@noble`). Each anchor lives at its own subpath with an optional peer dependency.

## Quick start

```ts
import { ReceiptLog, ed25519Signer, recordPolicyEvents, verifyLog } from "@iamyoungjohn-kit/receipts";
import { JsonlFileStore } from "@iamyoungjohn-kit/receipts/node";

const log = new ReceiptLog({ signer: ed25519Signer(process.env.RECEIPT_KEY), store: new JsonlFileStore("receipts.jsonl") });

recordPolicyEvents(engine, log);                       // every policy decision/execution → receipt
await log.append("x402.settled", { tx, amount: 10_000n }); // or record anything yourself

const { anchor, upload } = await log.publish({ anchorer, uploader }); // upload log, anchor head, record it
const result = await verifyLog(receipts, { anchor: { seq, head }, trustedActors: [signerId] });
```

A receipt has this shape: `{ v, seq, prev, ts, type, actor, data, hash, sig }`. `data` is normalised before hashing: bigints become strings, Dates become ISO strings, and bytes become hex. The stored value is exactly what was hashed.

## Signers

| Scheme | Signer | Verifier |
| --- | --- | --- |
| `ed25519` | `ed25519Signer(secretKey?)` | built in |
| `eip191` | `eip191Signer(viemAccount)` from `/evm` | pass `{ verifiers: { eip191: eip191Verifier } }` |

## Anchors and storage

| Where | Import | Notes |
| --- | --- | --- |
| EVM event | `evmAnchorer({ chainId, wallet, contract })` from `/evm` | Uses `ReceiptAnchor.sol` from `@iamyoungjohn-kit/contracts`. Query with `readEvmAnchors`. |
| EVM calldata | `evmAnchorer({ chainId, wallet })` | Needs no deployment. The anchor is a 0-value self-tx tagged `kitrcpt1` (`parseCalldataAnchor`). |
| Solana memo | `anchorMemoInstruction(checkpoint, signer)` from `/solana` | Returns a `@solana/kit`-shaped instruction to add to your tx. |
| Sui event | `suiAnchorer({ packageId, network, execute })` from `/sui` | Uses `kit_escrow::anchor` from `@iamyoungjohn-kit/contracts`. |
| Walrus | `walrusUploader()` from `/walrus` | Uses the HTTP publisher API with testnet defaults. URIs look like `walrus://<blobId>`. Read logs back with `readWalrusUri`. |

You can write your own anchorer or uploader for anything else (IPFS pinning, S3, …). Each is a single-method interface.

## Verified so far

- **Unit tests:** tampering (edits, re-hashed edits, deletion, reordering, forged signatures, untrusted actors), concurrent appends, the file store, the policy recorder, and Walrus (mocked).
- **EVM:** contract and calldata anchoring tested on anvil.
- **Sui:** anchoring checked manually on a Sui localnet.
- **Not run against live networks yet:** the Solana memo is checked for shape only, and Walrus uploads were tested with mocks. Run the example with `--walrus` to try Walrus testnet.

## Example

```bash
pnpm --filter @iamyoungjohn-kit/receipts example            # policy → receipts → anchor → auditor verifies (local anvil)
pnpm --filter @iamyoungjohn-kit/receipts example -- --walrus # also uploads the log to Walrus testnet
```
