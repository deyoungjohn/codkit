# @codkit/config

## 0.1.2

### Patch Changes

- b36e228: Contracts consumable from other repos: `forge install deyoungjohn/codkit` maps `codkit/` to the Solidity sources, `DeploymentRecorder.sol` writes `deployments/<chainId>.json` from a Foundry deploy script, and every deployment record carries `chain` + `contracts`. `@codkit/config` adds `parseDeployment`, `findDeployment` and `contractAddress`.

## 0.1.1

### Patch Changes

- 7b3245a: Sui chains carry `graphqlUrl` (public fullnodes no longer serve JSON-RPC), and the docs note that Sui `rpcUrls` are gRPC base URLs.
