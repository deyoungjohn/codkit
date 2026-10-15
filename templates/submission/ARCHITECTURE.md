# Architecture

Copy and edit this. Rename the boxes to your product, and delete what you don't use.

```mermaid
flowchart LR
  user([User]) -->|task| ui[Dashboard<br/>Next.js]
  ui -->|SSE live feed| ui
  ui -->|run / approve / kill| agent

  subgraph backend[Agent backend]
    agent[Claude agent loop<br/>tool runner] --> tools[Kit tools<br/>Zod schemas]
    tools --> policy{Policy engine<br/>caps · allow-lists<br/>simulate · approve<br/>kill switch}
    policy -->|allowed| pay[x402 client<br/>budgeted]
    policy -->|allowed| tx[EVM / Sui tx<br/>guarded send]
    policy -. needs human .-> ui
    policy --> receipts[(Receipt log<br/>signed · hash-chained)]
    tools --> receipts
  end

  pay -->|HTTP 402 → pay → retry| api[Sponsor API<br/>x402 paywall]
  api --> fac[x402 facilitator] --> chain[(Base / Solana)]
  tx --> escrow[Escrow + Reputation<br/>contracts] --> chain
  receipts -->|head hash| anchor[ReceiptAnchor<br/>event / memo] --> chain
  receipts -->|full log| walrus[(Walrus)]

  mcp[MCP clients<br/>Claude Code · Desktop] -->|stdio / HTTP| tools
```

## Trust boundaries (judges ask about these)

- **The model never holds keys.** Tools call the policy engine, which signs only allowed actions. Spend is reserved before anything is signed.
- **Simulation runs before every onchain write.** A reverting transaction is never sent.
- **Humans approve anything above the threshold** from the dashboard. Without a response, the request times out and is denied.
- **The kill switch** stops all spending immediately. The agent can engage it itself, but only a human can release it.
- **The receipt log** lets anyone verify what the agent did: check the log on Walrus against the head hash anchored onchain.
