# Deployments

One JSON file per public network, written by the deploy scripts. Never edit these by hand.

- `node scripts/deploy-evm.mjs --network base-sepolia --account <keystore> --verify` writes `base-sepolia.json`
- `node scripts/deploy-sui.mjs --network testnet` writes `sui-testnet.json`

`src/deployments.ts` is regenerated from these files, so `import { deployments } from "@codkit/contracts"` gives typed addresses. Local rehearsals (`local.json`, `sui-localnet.json`) are git-ignored and excluded.
