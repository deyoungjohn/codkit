# codkit e2e — agent-tools-testnets

2026-11-24T18:18:35.529Z · **PASS** (16/16)

- evmAgent: `0x144509235A869cd391e644d46d19b6a4CB09b9C3`
- solanaAgent: `Bc8MUG6gkGGie7fYftZpZNHBCPnLiV3r1hkhUNALnN38`

| Step | Result | Detail |
| --- | --- | --- |
| base-sepolia: preflight balances | ✅ | 0.497885494369997027 ETH, 20 USDC |
| base-sepolia: get_balance matches the chain | ✅ | {"ETH":"0.497885494369997027","USDC":"20"} |
| base-sepolia: quote_swap ETH → USDC through Uniswap v3 | ✅ | 0.0001 ETH → 0.025222 USDC (at least 0.025095) |
| base-sepolia: dry run previews the swap and sends nothing | ✅ | would succeed; policy allow; simulation ok |
| base-sepolia: an operator-forced dry run can't be switched off by the model | ✅ | dryRun:false was overridden; nothing sent |
| base-sepolia: the per-call cap refuses 0.01 ETH before anything else happens | ✅ | per-call cap: 0.01 ETH is more than the 0.0005 ETH allowed in one call |
| base-sepolia: the policy engine denies what the cap allows | ✅ | denied: denied: ETH: 300000000000000 exceeds per-tx cap 200000000000000 |
| base-sepolia: LIVE swap 0.0001 ETH → USDC | ✅ | received 0.025222 USDC (guaranteed ≥ 0.025095); policy allowed [link](https://sepolia.basescan.org/tx/0xa21d711a095ad2489a714d0e099df41da36642aa37ac91ba88824319ac36cd95) |
| base-sepolia: LIVE swap USDC → ETH (approves exactly the input, swaps, unwraps) | ✅ | sold 0.025222 USDC for ETH; allowance back to 0 (approved exactly the input) [link1](https://sepolia.basescan.org/tx/0xf568104d056218b2aa008380a3f75f78ccc6b543e9c0547f7ebdb7ede3d2a653) [link2](https://sepolia.basescan.org/tx/0x87efdb9b83c8fb86430eea56ce326fcaec36e821a27352c4784abacc26aee7b7) |
| base-sepolia: LIVE transfers to itself (USDC and ETH) | ✅ | 0.01 USDC and 0.000001 ETH sent [link1](https://sepolia.basescan.org/tx/0x3f17753a28078722cee2c2e7b7a481b9261673beec93c58adef03527736c56e7) [link2](https://sepolia.basescan.org/tx/0x6337cf16a81117f513ccc26f76663dd058d1a8c4cf385cf1219aac136612d7fb) |
| base-sepolia: the spend ledger holds every live spend, each with its tx hash | ✅ | 4 committed spends (swap ×2, transfer ×2); nothing left reserved |
| mainnet (READ-ONLY): LI.FI quotes Base USDC → ETH and the response passes validation | ✅ | 1 USDC → 0.000592524028444016 ETH (at least 0.000589561408301795); spender 0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE; nothing signed |
| solana-devnet: get_balance | ✅ | {"SOL":"0.29443336","USDC":"20"} |
| solana-devnet: the per-call cap refuses 0.01 SOL; a dry run sends nothing | ✅ | per-call cap: 0.01 SOL is more than the 0.005 SOL allowed in one call; dry run simulated ok |
| solana-devnet: LIVE transfers to itself (SOL and USDC) | ✅ | 0.000001 SOL and 0.01 USDC sent and confirmed [link1](https://explorer.solana.com/tx/3MvpBwjuVqArv1ZUqmWCei1axWUmYg6YDENbr7hBftcs5bgyBUEpAG1xRpaiuoNokE1Yc8myXJtNv7GRtm72fuC2?cluster=devnet) [link2](https://explorer.solana.com/tx/5CPXG7aHnNv7xW6Udwpdf81hLt4ME3BB2ZQacSj4LtNDZcUBjbdFYAaihukFaznLSj6L7KkZh5VFHNXymezCctNP?cluster=devnet) |
| mainnet (READ-ONLY): a real Jupiter swap transaction simulates cleanly and only calls allowed programs | ✅ | 0.05 SOL → 3.481789 USDC (at least 3.464381); simulated OK on mainnet, 4 top-level programs all allowed; nothing signed or sent |
