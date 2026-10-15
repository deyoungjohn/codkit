"use client";

import type { FeedEvent } from "@iamyoungjohn-kit/feed";
import { useEffect, useMemo, useRef, useState } from "react";
import { post, useFeed, useSnapshot, useWallet } from "./hooks";

type Of<K extends FeedEvent["kind"]> = Extract<FeedEvent, { kind: K }>;

const DEFAULT_PROMPT =
  "Get current ETH and SOL prices from the data vendor, then the market summary. If the full market report fits the budget, buy it too; otherwise explain why not.";

export function Dashboard() {
  const { events, connected, clear } = useFeed();
  const lastId = events.at(-1)?.id ?? 0;
  const { snap, refresh } = useSnapshot(lastId);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);

  const by = useMemo(() => {
    const pick = <K extends FeedEvent["kind"]>(...kinds: K[]) => events.filter((e): e is Of<K> => (kinds as string[]).includes(e.kind));
    const answered = new Set(pick("approval").map((a) => a.requestId).filter(Boolean));
    return {
      trace: pick("thinking", "message", "tool_call", "tool_result", "status"),
      decisions: pick("policy", "approval"),
      txs: pick("tx"),
      receipts: pick("receipt"),
      pending: pick("approval_request").filter((r) => !answered.has(r.requestId) && snap?.pendingApprovals.some((p) => p.requestId === r.requestId)),
    };
  }, [events, snap]);

  const blocked = by.decisions.filter((d) => d.kind === "policy" && d.verdict === "deny").length;
  const running = snap?.running ?? false;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6">
      <Header mode={snap?.mode} connected={connected} />

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Spent today" value={snap ? `${snap.budget.spent} / ${snap.budget.perDay ?? "∞"}` : "–"} unit="USDC" />
        <Stat label="Per payment cap" value={snap?.budget.perTx ?? "–"} unit="USDC" />
        <Stat label="Payments settled" value={snap?.payments ?? "–"} />
        <Stat label="Blocked by policy" value={blocked} tone={blocked ? "deny" : undefined} />
        <Stat
          label="Receipts"
          value={snap?.receipts.count ?? "–"}
          unit={!snap ? undefined : snap.receipts.ok ? "verified ✓" : "invalid ✗"}
          tone={snap && !snap.receipts.ok ? "deny" : undefined}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Task">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              className="w-full resize-y rounded-md border border-white/10 bg-black/30 p-3 text-sm outline-none focus:border-sky-400/60"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                disabled={running || snap?.killed}
                onClick={async () => {
                  await post("/api/run", { prompt });
                  void refresh();
                }}
                className="rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {running ? "Running…" : "Run agent"}
              </button>
              <KillSwitch killed={snap?.killed ?? false} onChange={refresh} />
              <button
                disabled={running}
                onClick={async () => {
                  await post("/api/reset");
                  clear();
                  void refresh();
                }}
                className="rounded-md border border-white/10 px-3 py-2 text-sm text-white/70 hover:bg-white/5 disabled:opacity-40"
              >
                Reset
              </button>
              {snap && (
                <span className="ml-auto text-xs text-white/40">
                  {snap.mode === "demo" ? "Demo mode: scripted agent, real policy + x402 + receipts" : "Live: Claude drives the tools"}
                </span>
              )}
            </div>
          </Card>

          <Card title="Reasoning trace" subtitle={`${by.trace.length} steps`}>
            <Trace items={by.trace} />
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {by.pending.length > 0 && <Approvals items={by.pending} onDone={refresh} />}
          <Card title="Policy decisions" subtitle="every action is checked before anything is signed">
            <Decisions items={by.decisions} />
          </Card>
          <Card title="Transactions" subtitle="settled payments with explorer links">
            <Txs items={by.txs} />
          </Card>
          <Card title="Receipt log" subtitle="signed, hash-chained, anchorable">
            <Receipts items={by.receipts} head={snap?.receipts.head ?? null} signer={snap?.receipts.signer ?? ""} ok={snap?.receipts.ok ?? true} />
          </Card>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ pieces

function Header({ mode, connected }: { mode?: "demo" | "live"; connected: boolean }) {
  return (
    <header className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2.5">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-sky-500/15 text-sky-300">◆</div>
        <div>
          <h1 className="text-base font-semibold leading-tight">Agent Console</h1>
          <p className="text-xs text-white/45">AI agent · policy-bounded · paid in USDC via x402 · verifiable receipts</p>
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {mode && <Badge tone={mode === "live" ? "allow" : "neutral"}>{mode === "live" ? "Claude live" : "Demo mode"}</Badge>}
        <Badge tone={connected ? "allow" : "deny"}>{connected ? "● feed live" : "○ feed offline"}</Badge>
        <WalletButton />
      </div>
    </header>
  );
}

function WalletButton() {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  if (w.account) {
    return (
      <button onClick={w.disconnect} className="rounded-md border border-white/10 px-3 py-1.5 font-mono text-xs hover:bg-white/5" title="Disconnect">
        {short(w.account)} · {w.chainId === 84532 ? "Base Sepolia" : `chain ${w.chainId}`}
      </button>
    );
  }
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="rounded-md border border-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/5">
        Connect wallet
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-2 w-56 rounded-lg border border-white/10 bg-[#141821] p-1.5 shadow-xl">
          {w.providers.length === 0 && <p className="p-2 text-xs text-white/50">No browser wallet detected.</p>}
          {w.providers.map((p) => (
            <button
              key={p.info.uuid}
              onClick={() => {
                setOpen(false);
                void w.connect(p);
              }}
              className="flex w-full items-center gap-2 rounded-md p-2 text-left text-sm hover:bg-white/5"
            >
              {p.info.icon && <img src={p.info.icon} alt="" className="h-5 w-5" />}
              {p.info.name}
            </button>
          ))}
          {w.error && <p className="p-2 text-xs text-rose-300">{w.error}</p>}
        </div>
      )}
    </div>
  );
}

function KillSwitch({ killed, onChange }: { killed: boolean; onChange: () => void }) {
  return (
    <button
      onClick={async () => {
        await post("/api/kill", { engaged: !killed });
        onChange();
      }}
      className={
        killed
          ? "rounded-md border border-emerald-400/40 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-400/10"
          : "rounded-md bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-500"
      }
    >
      {killed ? "Release kill switch" : "Kill switch"}
    </button>
  );
}

function Trace({ items }: { items: Of<"thinking" | "message" | "tool_call" | "tool_result" | "status">[] }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); // follow the agent
  }, [items.length]);
  if (!items.length) return <Empty>Run the agent to see its reasoning, tool calls and results here.</Empty>;
  return (
    <ol ref={ref} className="flex max-h-[620px] flex-col gap-2 overflow-y-auto pr-1">
      {items.map((e) => (
        <li key={e.id} className="enter">
          {e.kind === "thinking" && <p className="border-l-2 border-violet-400/40 pl-3 text-sm italic text-white/60">{e.text}</p>}
          {e.kind === "message" && <p className="whitespace-pre-wrap rounded-md bg-sky-400/10 p-3 text-sm text-sky-100">{e.text}</p>}
          {e.kind === "tool_call" && (
            <div className="rounded-md border border-white/10 bg-black/25 px-3 py-2 font-mono text-xs">
              <span className="text-amber-300">→ {e.name}</span> <span className="break-all text-white/50">{JSON.stringify(e.input)}</span>
            </div>
          )}
          {e.kind === "tool_result" && (
            <details className={`rounded-md border px-3 py-2 font-mono text-xs ${e.ok ? "border-white/10" : "border-rose-400/40 bg-rose-500/5"}`}>
              <summary className="cursor-pointer select-none">
                <span className={e.ok ? "text-emerald-300" : "text-rose-300"}>
                  ← {e.name} {e.ok ? "ok" : "error"}
                </span>{" "}
                <span className="text-white/35">{e.ms}ms</span>
                {!e.ok && <span className="ml-2 text-rose-200/80">{e.output.slice(0, 140)}</span>}
              </summary>
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all text-white/60">{e.output}</pre>
            </details>
          )}
          {e.kind === "status" && (
            <p className="text-xs text-white/40">
              — {e.state}
              {e.detail ? `: ${e.detail}` : ""}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

function Approvals({ items, onDone }: { items: Of<"approval_request">[]; onDone: () => void }) {
  return (
    <section className="enter rounded-xl border border-amber-400/40 bg-amber-400/5 p-4">
      <h2 className="text-sm font-semibold text-amber-200">Approval needed</h2>
      {items.map((r) => (
        <div key={r.requestId} className="mt-3 flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-sm">{r.summary}</p>
            <p className="text-xs text-white/50">{r.reasons.join("; ")}</p>
          </div>
          <button
            onClick={async () => {
              await post("/api/approve", { requestId: r.requestId, approved: true, by: "dashboard" });
              onDone();
            }}
            className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-black hover:bg-emerald-400"
          >
            Approve
          </button>
          <button
            onClick={async () => {
              await post("/api/approve", { requestId: r.requestId, approved: false, by: "dashboard" });
              onDone();
            }}
            className="rounded-md border border-white/15 px-3 py-1.5 text-sm hover:bg-white/5"
          >
            Deny
          </button>
        </div>
      ))}
    </section>
  );
}

function Decisions({ items }: { items: Of<"policy" | "approval">[] }) {
  if (!items.length) return <Empty>Allowed and blocked actions appear here.</Empty>;
  return (
    <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1">
      {[...items].reverse().map((d) => (
        <li key={d.id} className="enter flex items-start gap-2 text-sm">
          {d.kind === "policy" ? (
            <>
              <Badge tone={d.verdict === "allow" ? "allow" : d.verdict === "deny" ? "deny" : "warn"}>
                {d.verdict === "require_approval" ? "approval" : d.verdict === "allow" ? "allowed" : "blocked"}
              </Badge>
              <div className="min-w-0">
                <p className="truncate font-mono text-xs">{d.summary}</p>
                {d.reasons.length > 0 && <p className="text-xs text-white/50">{d.reasons.join("; ")}</p>}
              </div>
            </>
          ) : (
            <>
              <Badge tone={d.approved ? "allow" : "deny"}>{d.approved ? "approved" : "declined"}</Badge>
              <p className="min-w-0 truncate font-mono text-xs">
                {d.summary} <span className="text-white/45">by {d.by ?? d.note ?? "—"}</span>
              </p>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function Txs({ items }: { items: Of<"tx">[] }) {
  if (!items.length) return <Empty>No transactions yet.</Empty>;
  return (
    <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-1">
      {[...items].reverse().map((t) => (
        <li key={t.id} className="enter flex items-center gap-2 text-xs">
          <Badge tone="allow">{t.status}</Badge>
          <span className="min-w-0 flex-1 truncate font-mono">{t.label}</span>
          {t.url ? (
            <a href={t.url} target="_blank" rel="noreferrer" className="font-mono text-sky-300 hover:underline">
              {short(t.hash)} ↗
            </a>
          ) : (
            <span className="font-mono text-white/40" title="simulated settlement (demo vendor)">
              {short(t.hash)} · sim
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Receipts({ items, head, signer, ok }: { items: Of<"receipt">[]; head: string | null; signer: string; ok: boolean }) {
  return (
    <div>
      <div className="mb-2 grid gap-1 text-xs text-white/50">
        <p>
          head <span className="font-mono text-white/80">{head ? short(head, 10) : "—"}</span>{" "}
          {head && <span className={ok ? "text-emerald-300" : "text-rose-300"}>{ok ? "chain verified" : "verification failed"}</span>}
        </p>
        <p className="truncate">
          signer <span className="font-mono">{short(signer.replace(/^ed25519:/, ""), 10)}</span>
        </p>
      </div>
      {items.length === 0 ? (
        <Empty>Receipts are written for every decision, payment and note.</Empty>
      ) : (
        <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto pr-1 font-mono text-xs">
          {[...items].reverse().map((r) => (
            <li key={r.id} className="enter flex gap-2">
              <span className="w-8 text-right text-white/35">#{r.seq}</span>
              <span className="w-36 truncate text-white/75">{r.type}</span>
              <span className="truncate text-white/40">{r.hash}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// -------------------------------------------------------------- primitives

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && <span className="text-xs text-white/40">{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, unit, tone }: { label: string; value: string | number; unit?: string; tone?: "deny" }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <p className="text-xs text-white/45">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${tone === "deny" ? "text-rose-300" : ""}`}>
        {value} {unit && <span className="text-xs font-normal text-white/45">{unit}</span>}
      </p>
    </div>
  );
}

function Badge({ tone, children }: { tone: "allow" | "deny" | "warn" | "neutral"; children: React.ReactNode }) {
  const cls = {
    allow: "bg-emerald-400/15 text-emerald-300",
    deny: "bg-rose-400/15 text-rose-300",
    warn: "bg-amber-400/15 text-amber-200",
    neutral: "bg-white/10 text-white/70",
  }[tone];
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-center text-xs text-white/35">{children}</p>;
}

function short(s: string, n = 6) {
  return s.length > n * 2 + 2 ? `${s.slice(0, n + 2)}…${s.slice(-4)}` : s;
}
