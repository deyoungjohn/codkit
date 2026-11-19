---
"@codkit/contracts": patch
"@codkit/config": patch
---

Contracts consumable from other repos: `forge install deyoungjohn/codkit` maps `codkit/` to the Solidity sources, `DeploymentRecorder.sol` writes `deployments/<chainId>.json` from a Foundry deploy script, and every deployment record carries `chain` + `contracts`. `@codkit/config` adds `parseDeployment`, `findDeployment` and `contractAddress`.
