# Submission checklist

## Before you start building

- [ ] Read the rules. Is pre-existing code allowed? (5 of 57 events studied banned it, 10 allowed it with conditions, and 15 required original work.)
- [ ] Note the kit version or commit you start from, so "built during the hackathon" is provable.
- [ ] Pick the sponsor tracks. The same product can often enter several, so check each track's rules.

## Product

- [ ] The sponsor's tech is load-bearing, not a logo. You can say what breaks without it.
- [ ] The happy path works end to end on testnet, and so does one failure path (a block, a refund, an approval).
- [ ] Testnet only. No mainnet keys in `.env`, and nothing secret committed (`git log -p | grep -i private`).

## Submission

- [ ] The README follows `templates/submission/README.md`, with the demo link in the first screen.
- [ ] The demo video is 3 minutes or less, with captions, and shows the product, not slides.
- [ ] The deployed-contracts table is filled in with explorer links (`pnpm --filter @codkit/contracts deployments`).
- [ ] The architecture diagram is included.
- [ ] The kit is disclosed as prior work, with what you built during the event listed separately.
- [ ] The repo is public, and the license file is present.
- [ ] A live URL works in an incognito window (Vercel / Fly / Railway).
- [ ] Team members and contacts are listed.

## Day-of demo

- [ ] The testnet wallet is funded (gas, plus USDC from https://faucet.circle.com).
- [ ] There's a backup recording in case the live demo fails.
- [ ] The dashboard has been reset, and an LLM key (`GROQ_API_KEY`, `GEMINI_API_KEY`, …) is set if you're demoing the live agent. Set two so a free-tier rate limit fails over instead of stalling the demo.
