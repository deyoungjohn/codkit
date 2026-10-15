<!--
  Submission README template. Replace every <…>. Delete sections that don't apply.
  Judges skim. Put the demo link, the one-line pitch, and the sponsor integration
  in the first screen.
-->

# <Project name>

**<One line: who it's for and what the agent does for them, e.g. "An AI treasury agent that pays contractors in USDC, within limits a DAO sets onchain.">**

[▶ Demo video (3 min)](<link>) · [Live app](<link>) · [Pitch deck](<link>)

![screenshot](<path/to/screenshot.png>)

## The problem

<2–3 sentences. A real user with a real pain, and if you can, a number: "Teams spend X hours / $Y on …".>

## What it does

1. <User does …>
2. <Agent decides …, bounded by policy (spend caps, allow-lists, human approval above $N)>
3. <Agent pays / executes onchain via <sponsor tech>>
4. <Every step lands in a signed, hash-chained receipt log, anchored on <chain>>

## Built with <Sponsor> (how it's load-bearing)

<The judging criterion most teams under-explain. Say exactly which sponsor APIs or contracts you call, what would break without them, and link the code.>

| Sponsor tech | Where | What it does in our product |
| --- | --- | --- |
| <e.g. x402 on Base> | [`<file>`](<link>) | <pays for each API call per request> |
| <…> | | |

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md).

```mermaid
<paste the diagram from ARCHITECTURE.md>
```

## Deployed contracts

<!-- generate with: pnpm --filter @iamyoungjohn-kit/contracts deployments -->

| Contract | Network | Address | Deploy tx |
| --- | --- | --- | --- |
| <…> | | | |

## Run it

```bash
pnpm install
cp .env.example .env   # testnet keys only
pnpm dev
```

## What we built during the hackathon

<Be explicit, since many events require original work. List what's new. Point to the commit range.>

- <feature> — <commit/PR link>

## Prior work and dependencies (disclosure)

This project uses **[Hackathon Kit](https://github.com/deyoungjohn/kit)**, a public MIT-licensed toolkit written before this event, for its generic plumbing:

- `@iamyoungjohn-kit/policy`: spend caps, allow-lists, approvals, kill switch
- `@iamyoungjohn-kit/pay`: x402 middleware and budgeted client
- `@iamyoungjohn-kit/receipts`: signed action log and onchain anchoring
- <…only list the ones you use>

The product idea, the <sponsor> integration, <…> and the UI were built during the hackathon (see above).

## Team

- <Name>: <role> · <link>

## What's next

<2–3 bullets: who you'd sell to first, what you'd build next, and any traction (users, LOIs, waitlist).>
