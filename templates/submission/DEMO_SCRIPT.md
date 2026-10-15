# Demo video script (≈3 minutes)

Judges score "working product" highest (75% of events), then originality, usefulness, and UX. So show the product working, show a moment of tension, and show the sponsor tech doing the real work.

| Time | Show | Say |
| --- | --- | --- |
| 0:00–0:15 | Title card, then straight to the app | "<User> wastes <time/money> on <problem>. <Product> is an AI agent that <does it>, paid in USDC, and it can't go off the rails." |
| 0:15–0:35 | Dashboard idle: budget tiles, policy caps | "The agent has a budget: 0.50 per payment, 1 a day. Anything above 0.10 needs me." |
| 0:35–1:15 | Click **Run agent**. Narrate the reasoning trace as it fills | "It checks its budget first… buys the ETH and SOL quotes via x402. Each one is a real USDC payment over HTTP 402." Point at **Transactions** and click an explorer link. |
| 1:15–1:40 | **Approval needed** card appears. Click **Approve** | "This purchase is over my threshold, so it waits for me. Nothing is signed until I approve." |
| 1:40–2:05 | The $2 report is **blocked** (red) | "It wanted the full report, but that breaks the per-payment cap. The payment was refused before anything was signed." |
| 2:05–2:25 | Press **Kill switch** and try to run | "If anything looks wrong, one button stops all spending. The agent can pull it too, but it can't release it." |
| 2:25–2:45 | Receipt log: `chain verified`, then the anchor tx in the explorer | "Every decision is in a signed, hash-chained log, anchored on <chain>. Anyone can audit what the agent did." |
| 2:45–3:00 | Architecture diagram, then the sponsor logo | "Built on <sponsor tech>: <one line on why it's essential>. Next: <first customer / next feature>." |

## Recording tips

- Record at 1440×900. Zoom the browser to 110–125% so text is readable on a phone.
- Use the demo-shell's **Reset** between takes. In demo mode, `DEMO_STEP_MS=1200` paces the scripted run for narration.
- Rehearse the approval click. It's the moment judges remember.
- Captions help: many judges watch muted.
- Keep it under the event's limit (often 3 or 5 minutes). Cut silence, not the tension beats.
