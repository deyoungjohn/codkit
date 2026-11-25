"use client";

import type { FeedEvent } from "@codkit/feed";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { post, useFeed, useSnapshot, useWallet } from "./hooks";
import { Icon } from "./icons";

type Of<K extends FeedEvent["kind"]> = Extract<FeedEvent, { kind: K }>;
type Tab = "trace" | "decisions" | "payments" | "receipts";

const DEFAULT_PROMPT =
  "Get current ETH and SOL prices from the data vendor, then the market summary. If the full market report fits the budget, buy it too; otherwise explain why not.";
const REPO = "https://github.com/deyoungjohn/codkit";

const usdc = (label: string) => Number(/(\d+(?:\.\d+)?)\s*USDC/.exec(label)?.[1] ?? 0);
const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

// Shared class strings: one primary action, one quiet companion, one hairline card.
const BTN = "inline-flex h-9 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors duration-150";
const PRIMARY = `${BTN} bg-fg text-canvas shadow-[inset_0_1px_0_rgb(255_255_255/0.12)] hover:bg-white active:scale-[0.98] disabled:opacity-40 disabled:hover:bg-fg`;
const SECONDARY = `${BTN} border border-line bg-raised text-fg hover:border-line-strong active:scale-[0.98] disabled:opacity-40`;
const CARD = "rounded-2xl border border-line bg-card";

export function Dashboard() {
  const { events, connected, clear } = useFeed();
  const lastId = events.at(-1)?.id ?? 0;
  const { snap, refresh } = useSnapshot(lastId);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [tab, setTab] = useState<Tab>("trace");

  const by = useMemo(() => {
    const pick = <K extends FeedEvent["kind"]>(...kinds: K[]) => events.filter((e): e is Of<K> => (kinds as string[]).includes(e.kind));
    const answered = new Set(
      pick("approval")
        .map((a) => a.requestId)
        .filter(Boolean),
    );
    return {
      trace: pick("thinking", "message", "tool_call", "tool_result", "status"),
      decisions: pick("policy", "approval"),
      txs: pick("tx"),
      receipts: pick("receipt"),
      pending: pick("approval_request").filter(
        (r) => !answered.has(r.requestId) && snap?.pendingApprovals.some((p) => p.requestId === r.requestId),
      ),
    };
  }, [events, snap]);

  const blocked = by.decisions.filter((d) => d.kind === "policy" && d.verdict === "deny").length;
  const running = snap?.running ?? false;
  const killed = snap?.killed ?? false;
  const spent = Number(snap?.budget.spent ?? 0);
  const perDay = Number(snap?.budget.perDay ?? 0);
  const usedPct = perDay ? Math.min(100, Math.round((spent / perDay) * 100)) : 0;
  const lastAt = events.at(-1)?.ts;
  const model = snap?.mode === "live" ? (snap.llm ?? "LLM") : "Scripted agent";

  const run = async () => {
    await post("/api/run", { prompt });
    void refresh();
  };
  const reset = async () => {
    await post("/api/reset");
    clear();
    void refresh();
  };
  const toggleKill = async () => {
    await post("/api/kill", { engaged: !killed });
    void refresh();
  };
  const goto = (t: Tab) => {
    setTab(t);
    document.getElementById("session")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="flex min-h-screen">
      <Sidebar mode={snap?.mode} txs={by.txs} killed={killed} onKill={toggleKill} tab={tab} onNav={goto} />

      <main className="min-w-0 flex-1">
        <TopBar
          mode={snap?.mode}
          auth={snap?.auth}
          running={running}
          killed={killed}
          onRun={run}
          connected={connected}
          pending={by.pending.length}
        />

        <div className="mx-auto flex max-w-[1440px] flex-col gap-8 px-5 pb-16 pt-8 sm:px-8">
          {by.pending.length > 0 && <Approvals items={by.pending} onDone={refresh} />}

          {/* ---------------------------------------------------- budget */}
          <section aria-labelledby="budget-title" className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="flex min-w-0 flex-col gap-6">
              <div>
                <h1 id="budget-title" className="text-[32px] font-medium leading-[1.15] text-fg">
                  Agent budget
                </h1>
                <p className="mt-2 text-sm text-fg-2">
                  Spending under policy, settled in USDC on Base Sepolia over x402. Driven by {model.toLowerCase()}.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <Stat
                  label="Spent today"
                  value={fmt(spent)}
                  unit="USDC"
                  note={perDay ? `${usedPct}% of the ${fmt(perDay)} daily cap` : "No daily cap set"}
                  onOpen={() => goto("payments")}
                />
                <Stat
                  label="Payments settled"
                  value={String(snap?.payments ?? 0)}
                  note={`${by.txs.length} in this run`}
                  onOpen={() => goto("payments")}
                />
                <Stat
                  label="Refused before signing"
                  value={String(blocked)}
                  note={`${by.decisions.length} policy checks this run`}
                  tone={blocked ? "bad" : undefined}
                  onOpen={() => goto("decisions")}
                />
              </div>

              <Ledger
                txs={by.txs}
                spent={spent}
                perDay={perDay}
                perTx={Number(snap?.budget.perTx ?? 0)}
                approvalAbove={Number(snap?.budget.approvalAbove ?? 0)}
              />
            </div>

            <PolicyCard snap={snap} killed={killed} onKill={toggleKill} />
          </section>

          {/* --------------------------------------------------- session */}
          <section id="session" aria-labelledby="session-title" className={`${CARD} scroll-mt-6 p-5 sm:p-6`}>
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2 id="session-title" className="text-xl font-medium text-fg">
                    Agent session
                  </h2>
                  <p className="text-[13px] text-fg-3">Last update {lastAt ? timeAgo(lastAt) : "none yet"}</p>
                </div>
                <label className="mt-4 block">
                  <span className="mb-2 block text-[13px] text-fg-2">Task</span>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={3}
                    className="w-full resize-none rounded-lg border border-line bg-raised px-4 py-3 text-sm leading-relaxed text-fg outline-none transition-colors duration-150 placeholder:text-fg-3 hover:border-line-strong focus-visible:border-accent"
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-end gap-6 lg:flex-col lg:items-start">
                <div>
                  <p className="text-[13px] text-fg-2">Spent this session</p>
                  <p className="mt-1 text-[48px] font-medium leading-none tabular-nums text-fg">
                    {spent.toFixed(5)} <span className="text-base font-normal text-fg-3">USDC</span>
                  </p>
                </div>
                <div className="flex gap-3">
                  <button type="button" disabled={running || killed} onClick={run} className={`${PRIMARY} h-10 px-5`}>
                    {running ? "Running…" : "Run agent"}
                  </button>
                  <button type="button" disabled={running} onClick={reset} className={`${SECONDARY} h-10 px-5`}>
                    Reset
                  </button>
                </div>
              </div>
            </div>

            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                ["trace", "Reasoning", `${by.trace.length} steps`],
                ["decisions", "Decisions", `${by.decisions.length} policy verdicts`],
                ["payments", "Payments", `${by.txs.length} settlements`],
                ["receipts", "Receipts", `${snap?.receipts.count ?? 0} signed`],
              ]}
            >
              {tab === "trace" && <Trace items={by.trace} />}
              {tab === "decisions" && <Decisions items={by.decisions} />}
              {tab === "payments" && <Txs items={by.txs} />}
              {tab === "receipts" && (
                <Receipts
                  items={by.receipts}
                  head={snap?.receipts.head ?? null}
                  signer={snap?.receipts.signer ?? ""}
                  ok={snap?.receipts.ok ?? true}
                />
              )}
            </Tabs>
          </section>
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- sidebar

function Sidebar({
  mode,
  txs,
  killed,
  onKill,
  tab,
  onNav,
}: {
  mode?: "demo" | "live";
  txs: Of<"tx">[];
  killed: boolean;
  onKill: () => void;
  tab: Tab;
  onNav: (t: Tab) => void;
}) {
  const [open, setOpen] = useState(true);
  const listId = useId();
  const recent = [...txs].reverse().slice(0, 4);
  const nav: [Tab | null, string, (p: { className?: string }) => React.ReactNode][] = [
    [null, "Dashboard", Icon.Grid],
    ["trace", "Reasoning", Icon.Activity],
    ["decisions", "Policy decisions", Icon.Shield],
    ["payments", "Payments", Icon.Coin],
    ["receipts", "Receipt log", Icon.Receipt],
  ];
  const row = "flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors duration-150";
  return (
    <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col border-r border-line bg-rail lg:flex">
      <div className="flex h-16 items-center gap-3 border-b border-line px-5">
        <Logo />
        <p className="text-base font-medium text-fg">codkit</p>
        <p className="text-[13px] text-fg-3">Agent console</p>
      </div>

      <dl className="flex items-center justify-between px-5 pt-5 text-[13px]">
        <dt className="text-fg-3">Mode</dt>
        <dd className="font-mono text-fg-2">{mode === "live" ? "Live LLM" : "Demo"}</dd>
      </dl>

      <nav aria-label="Console" className="mt-5 flex flex-col gap-0.5 px-3">
        {nav.map(([key, label, Ico]) => {
          const active = key !== null && tab === key;
          return (
            <button
              type="button"
              key={label}
              aria-current={key === null ? "page" : undefined}
              onClick={() => (key ? onNav(key) : window.scrollTo({ top: 0, behavior: "smooth" }))}
              className={`${row} ${
                key === null
                  ? "bg-raised text-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]"
                  : active
                    ? "text-fg"
                    : "text-fg-2 hover:bg-white/[0.04] hover:text-fg"
              }`}
            >
              <Ico className={`h-4 w-4 ${active || key === null ? "text-fg" : "text-fg-3"}`} />
              {label}
            </button>
          );
        })}
        <a href={`${REPO}#readme`} target="_blank" rel="noreferrer" className={`${row} text-fg-2 hover:bg-white/[0.04] hover:text-fg`}>
          <Icon.Book className="h-4 w-4 text-fg-3" /> Docs <Icon.ArrowUpRight className="ml-auto h-4 w-4 text-fg-3" />
        </a>
        <a
          href={`${REPO}/tree/main/packages/mcp`}
          target="_blank"
          rel="noreferrer"
          className={`${row} text-fg-2 hover:bg-white/[0.04] hover:text-fg`}
        >
          <Icon.Plug className="h-4 w-4 text-fg-3" /> MCP server <Icon.ArrowUpRight className="ml-auto h-4 w-4 text-fg-3" />
        </a>
      </nav>

      <div className="mt-6 px-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((o) => !o)}
          className={`${row} text-fg-2 hover:bg-white/[0.04] hover:text-fg`}
        >
          <Icon.Layers className="h-4 w-4 text-fg-3" /> Recent payments
          <span className="ml-auto font-mono text-xs tabular-nums text-fg-3">{txs.length}</span>
          <Icon.Chevron className={`h-4 w-4 text-fg-3 transition-transform duration-150 ${open ? "" : "-rotate-90"}`} />
        </button>
        {open && (
          <ul id={listId} className="mt-1 flex flex-col px-3">
            {recent.length === 0 && <li className="py-2 text-[13px] text-fg-3">No payments yet. Run the agent.</li>}
            {recent.map((t) => (
              <li key={t.id} className="flex h-9 items-center justify-between gap-3 text-[13px]">
                <span className="truncate text-fg-3">{t.url ? "Onchain" : "Simulated"}</span>
                <span className="font-mono tabular-nums text-fg">{fmt(usdc(t.label))} USDC</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-auto border-t border-line p-4">
        <button
          type="button"
          onClick={onKill}
          className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors duration-150 ${
            killed ? "border-ok/40 bg-ok/[0.06] hover:bg-ok/10" : "border-line bg-card hover:border-line-strong"
          }`}
        >
          <Icon.Power className={`h-4 w-4 ${killed ? "text-ok" : "text-fg-2"}`} />
          <span className="leading-tight">
            <span className="block text-sm text-fg">{killed ? "Release kill switch" : "Kill switch"}</span>
            <span className="block text-xs text-fg-3">{killed ? "Spending is halted" : "Stop all agent spending"}</span>
          </span>
        </button>
      </div>
    </aside>
  );
}

// ------------------------------------------------------------------ topbar

function TopBar({
  mode,
  auth,
  running,
  killed,
  onRun,
  connected,
  pending,
}: {
  mode?: "demo" | "live";
  auth?: "password" | "open" | "locked";
  running: boolean;
  killed: boolean;
  onRun: () => void;
  connected: boolean;
  pending: number;
}) {
  return (
    <header className="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-3 sm:px-8">
      <div className="flex items-center gap-3 lg:hidden">
        <Logo />
      </div>
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-full border border-line bg-raised text-xs font-medium text-fg-2">RA</span>
        <div className="leading-tight">
          <p className="text-sm font-medium text-fg">Research Agent</p>
          <p className="font-mono text-xs text-fg-3">@research-agent · {mode === "live" ? "live" : "demo"}</p>
        </div>
      </div>
      <button type="button" onClick={onRun} disabled={running || killed} className={`${PRIMARY} ml-2`}>
        {running ? "Running…" : "Run agent"} <Icon.Play className="h-4 w-4" />
      </button>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <span
          className="relative grid h-9 w-9 place-items-center rounded-lg border border-line text-fg-2"
          role="img"
          aria-label={`${pending} approval${pending === 1 ? "" : "s"} pending`}
          title={`${pending} approval(s) pending`}
        >
          <Icon.Bell className="h-4 w-4" />
          {pending > 0 && (
            <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[11px] font-medium text-on-accent">
              {pending}
            </span>
          )}
        </span>
        <span className="flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-[13px] text-fg-2">
          <span className={`live-dot h-2 w-2 rounded-full ${connected ? "bg-ok" : "bg-bad"}`} data-running={connected && running} />
          {connected ? "Live feed" : "Feed offline"}
        </span>
        <WalletButton />
        {auth === "open" && (
          <span
            className="flex h-9 items-center rounded-lg border border-warn/40 px-3 text-[13px] text-warn"
            title="Set DASHBOARD_PASSWORD to require sign-in"
          >
            Auth off (dev)
          </span>
        )}
        {auth === "password" && (
          <button
            type="button"
            onClick={async () => {
              await fetch("/api/logout", { method: "POST" });
              window.location.href = "/login";
            }}
            className={`${SECONDARY} h-9 px-3 text-[13px] font-normal text-fg-2 hover:text-fg`}
          >
            Sign out
          </button>
        )}
      </div>
    </header>
  );
}

function WalletButton({ block }: { block?: boolean }) {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const size = block ? `${SECONDARY} w-full` : `${SECONDARY} h-9 px-3 text-[13px] font-normal`;
  // close on Escape and on a click anywhere else
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (w.account) {
    return (
      <button type="button" onClick={w.disconnect} className={`${size} font-mono`} title="Disconnect">
        {short(w.account)} · {w.chainId === 84532 ? "Base Sepolia" : `chain ${w.chainId}`}
      </button>
    );
  }
  return (
    <div ref={box} className={`relative ${block ? "w-full" : ""}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" className={size}>
        Connect wallet <Icon.Wallet className="h-4 w-4 text-fg-3" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-60 rounded-xl border border-line-strong bg-raised p-1 shadow-[0_8px_24px_rgb(0_0_0/0.4)]"
        >
          {w.providers.length === 0 && <p className="p-3 text-xs text-fg-2">No browser wallet detected.</p>}
          {w.providers.map((p) => (
            <button
              type="button"
              role="menuitem"
              key={p.info.uuid}
              onClick={() => {
                setOpen(false);
                void w.connect(p);
              }}
              className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-fg transition-colors duration-150 hover:bg-white/[0.06]"
            >
              {/* biome-ignore lint/performance/noImgElement: EIP-6963 wallet icons are data URIs; next/image adds nothing */}
              {p.info.icon && <img src={p.info.icon} alt="" className="h-5 w-5 rounded" />}
              {p.info.name}
            </button>
          ))}
          {w.error && (
            <p role="alert" className="p-3 text-xs text-bad">
              {w.error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ budget pieces

/** A figure with what it is and what it compares to: no icons, charts or tiles added to fill the card. */
function Stat(p: { label: string; value: string; unit?: string; note: string; tone?: "bad"; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={p.onOpen}
      className={`${CARD} group flex min-h-[132px] flex-col p-5 text-left transition-colors duration-150 hover:border-line-strong`}
    >
      <span className="flex items-center justify-between gap-3 text-[13px] text-fg-2">
        {p.label}
        <Icon.ArrowUpRight className="h-4 w-4 text-fg-3 transition-colors duration-150 group-hover:text-fg" />
      </span>
      <span className="mt-4 text-[32px] font-medium leading-none tabular-nums text-fg">
        {p.value}
        {p.unit && <span className="ml-1.5 text-sm font-normal text-fg-3">{p.unit}</span>}
      </span>
      <span className={`mt-auto pt-3 text-[13px] ${p.tone === "bad" ? "text-bad" : "text-fg-3"}`}>{p.note}</span>
    </button>
  );
}

/**
 * The daily budget as one bar. Every payment is a segment sized by what it cost, so the day reads at a glance:
 * how many payments, how big, how much of the cap is left. The newest payment carries the accent.
 */
function Ledger({
  txs,
  spent,
  perDay,
  perTx,
  approvalAbove,
}: {
  txs: Of<"tx">[];
  spent: number;
  perDay: number;
  perTx: number;
  approvalAbove: number;
}) {
  const amounts = txs.map((t) => usdc(t.label));
  const total = Math.max(
    perDay,
    amounts.reduce((a, b) => a + b, 0),
    spent,
  );
  const left = Math.max(0, perDay - spent);
  return (
    <div className={`${CARD} p-5 sm:p-6`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="text-base font-medium text-fg">Daily budget</h2>
        <p className="text-sm tabular-nums text-fg-2">
          <span className="text-fg">{fmt(spent)}</span> of {fmt(perDay)} USDC, {fmt(left)} left
        </p>
      </div>
      <div
        role="img"
        aria-label={`${amounts.length} payment${amounts.length === 1 ? "" : "s"} totalling ${fmt(spent)} of ${fmt(perDay)} USDC`}
        className="mt-5 flex h-10 gap-0.5 overflow-hidden rounded-lg bg-raised"
      >
        {amounts.map((a, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: payments only ever append, so the index is the identity
            key={i}
            title={`Payment ${i + 1}: ${fmt(a)} USDC`}
            className={`enter h-full rounded-[4px] ${i === amounts.length - 1 ? "bg-accent" : "bg-fg/30"}`}
            style={{ width: `${total ? (a / total) * 100 : 0}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[11px] tabular-nums text-fg-3">
        <span>0</span>
        <span>{fmt(perDay)}</span>
      </div>
      {amounts.length === 0 && (
        <p className="mt-4 text-[13px] text-fg-3">No payments yet. Each one will appear here as a segment of the day's budget.</p>
      )}
      <dl className="mt-5 grid gap-x-8 gap-y-2 border-t border-line pt-4 text-[13px] sm:grid-cols-2">
        <div className="flex justify-between gap-4">
          <dt className="text-fg-3">Per-payment cap</dt>
          <dd className="font-mono tabular-nums text-fg">{perTx ? `${fmt(perTx)} USDC` : "–"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-fg-3">A human approves above</dt>
          <dd className="font-mono tabular-nums text-fg">{approvalAbove ? `${fmt(approvalAbove)} USDC` : "–"}</dd>
        </div>
      </dl>
    </div>
  );
}

function PolicyCard({ snap, killed, onKill }: { snap: ReturnType<typeof useSnapshot>["snap"]; killed: boolean; onKill: () => void }) {
  return (
    <div className={`${CARD} flex flex-col self-start p-6`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-medium text-fg">Spending policy</h2>
        <span className="flex items-center gap-2 text-[13px] text-fg-2">
          <span className={`h-2 w-2 rounded-full ${killed ? "bg-bad" : "bg-ok"}`} />
          {killed ? "Halted" : "Active"}
        </span>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-fg-2">
        Every payment is checked before anything is signed: at most {snap?.budget.perTx ?? "–"} USDC each, {snap?.budget.perDay ?? "–"} USDC
        a day, and a human approves anything above {snap?.budget.approvalAbove ?? "–"}.
      </p>
      <div className="mt-6 flex flex-col gap-3">
        <WalletButton block />
        <button type="button" onClick={onKill} className={`${killed ? PRIMARY : SECONDARY} w-full`}>
          {killed ? "Release kill switch" : "Engage kill switch"} <Icon.Lock className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- tab panels

function Tabs({
  value,
  onChange,
  tabs,
  children,
}: {
  value: Tab;
  onChange: (t: Tab) => void;
  tabs: readonly (readonly [Tab, string, string])[];
  children: React.ReactNode;
}) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  // Arrow keys move between tabs (WAI-ARIA tabs pattern)
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "Home" ? -i : e.key === "End" ? tabs.length - 1 - i : 0;
    if (!d) return;
    e.preventDefault();
    const next = (i + d + tabs.length) % tabs.length;
    onChange(tabs[next]![0]);
    refs.current[next]?.focus();
  };
  return (
    <div className="mt-8">
      <div role="tablist" aria-label="Session details" className="grid grid-cols-2 border-b border-line lg:grid-cols-4">
        {tabs.map(([key, title, sub], i) => (
          <button
            type="button"
            role="tab"
            key={key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`${id}-${key}`}
            aria-selected={value === key}
            aria-controls={`${id}-panel`}
            tabIndex={value === key ? 0 : -1}
            onClick={() => onChange(key)}
            onKeyDown={(e) => onKey(e, i)}
            className={`-mb-px border-b-2 px-1 py-3 text-left transition-colors duration-150 ${value === key ? "border-accent" : "border-transparent hover:border-line-strong"}`}
          >
            <span className={`block text-sm ${value === key ? "text-fg" : "text-fg-2"}`}>{title}</span>
            <span className="block text-xs text-fg-3">{sub}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${value}`} className="pt-5">
        {children}
      </div>
    </div>
  );
}

function Trace({ items }: { items: Of<"thinking" | "message" | "tool_call" | "tool_result" | "status">[] }) {
  const ref = useRef<HTMLOListElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when items are added, to follow the agent
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); // follow the agent
  }, [items.length]);
  if (!items.length) return <Empty>Run the agent to see its reasoning, tool calls and results here.</Empty>;
  return (
    <ol ref={ref} className="flex max-h-[400px] flex-col gap-2 overflow-y-auto pr-1">
      {items.map((e) => (
        <li key={e.id} className="enter">
          {e.kind === "thinking" && <p className="border-l border-line-strong pl-3 text-sm text-fg-2">{e.text}</p>}
          {e.kind === "message" && (
            <p className="whitespace-pre-wrap rounded-xl border border-line bg-raised p-4 text-sm text-fg">{e.text}</p>
          )}
          {e.kind === "tool_call" && (
            <div className="rounded-lg border border-line px-3 py-2 font-mono text-xs">
              <span className="text-accent">→ {e.name}</span> <span className="break-all text-fg-3">{JSON.stringify(e.input)}</span>
            </div>
          )}
          {e.kind === "tool_result" && (
            <details className={`rounded-lg border px-3 py-2 font-mono text-xs ${e.ok ? "border-line" : "border-bad/30 bg-bad/[0.05]"}`}>
              <summary className="cursor-pointer select-none">
                <span className={e.ok ? "text-ok" : "text-bad"}>
                  ← {e.name} {e.ok ? "ok" : "error"}
                </span>{" "}
                <span className="text-fg-3">{e.ms}ms</span>
                {!e.ok && <span className="ml-2 text-fg-2">{e.output.slice(0, 140)}</span>}
              </summary>
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all text-fg-2">{e.output}</pre>
            </details>
          )}
          {e.kind === "status" && (
            <p className="text-xs text-fg-3">
              {e.state}
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
    <section aria-label="Approval needed" className="enter rounded-2xl border border-warn/40 bg-warn/[0.06] p-5">
      <p className="flex items-center gap-2 text-sm font-medium text-fg">
        <Icon.Bell className="h-4 w-4 text-warn" /> Approval needed
      </p>
      {items.map((r) => (
        <div key={r.requestId} className="mt-4 flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-sm text-fg">{r.summary}</p>
            <p className="text-xs text-fg-2">{r.reasons.join("; ")}</p>
          </div>
          <button
            type="button"
            onClick={async () => {
              await post("/api/approve", { requestId: r.requestId, approved: true, by: "dashboard" });
              onDone();
            }}
            className={PRIMARY}
          >
            Approve
          </button>
          <button
            type="button"
            onClick={async () => {
              await post("/api/approve", { requestId: r.requestId, approved: false, by: "dashboard" });
              onDone();
            }}
            className={SECONDARY}
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
    <ul className="flex max-h-[400px] flex-col gap-2 overflow-y-auto pr-1">
      {[...items].reverse().map((d) => (
        <li key={d.id} className="enter flex items-start gap-3 rounded-lg border border-line px-3 py-3 text-sm">
          {d.kind === "policy" ? (
            <>
              <Badge tone={d.verdict === "allow" ? "allow" : d.verdict === "deny" ? "deny" : "warn"}>
                {d.verdict === "require_approval" ? "approval" : d.verdict === "allow" ? "allowed" : "blocked"}
              </Badge>
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-fg">{d.summary}</p>
                {d.reasons.length > 0 && <p className="mt-1 text-xs text-fg-2">{d.reasons.join("; ")}</p>}
              </div>
            </>
          ) : (
            <>
              <Badge tone={d.approved ? "allow" : "deny"}>{d.approved ? "approved" : "declined"}</Badge>
              <p className="min-w-0 truncate font-mono text-xs text-fg">
                {d.summary} <span className="text-fg-3">by {d.by ?? d.note ?? "—"}</span>
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
    <ul className="flex max-h-[400px] flex-col gap-2 overflow-y-auto pr-1">
      {[...items].reverse().map((t) => (
        <li key={t.id} className="enter flex items-center gap-3 rounded-lg border border-line px-3 py-3 text-xs">
          <Badge tone="allow">{t.status}</Badge>
          <span className="min-w-0 flex-1 truncate font-mono text-fg">{t.label}</span>
          {t.url ? (
            <a
              href={t.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-accent hover:underline"
            >
              {short(t.hash)} <Icon.ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          ) : (
            <span className="font-mono text-fg-3" title="simulated settlement (demo vendor)">
              {short(t.hash)} · simulated
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
      <div className="mb-4 flex flex-wrap gap-x-8 gap-y-1 text-xs text-fg-3">
        <p>
          Chain head <span className="font-mono text-fg">{head ? short(head, 10) : "—"}</span>{" "}
          {head && <span className={ok ? "text-ok" : "text-bad"}>{ok ? "verified" : "verification failed"}</span>}
        </p>
        <p className="truncate">
          Signer <span className="font-mono text-fg-2">{short(signer.replace(/^ed25519:/, ""), 10)}</span>
        </p>
      </div>
      {items.length === 0 ? (
        <Empty>Receipts are written for every decision, payment and note.</Empty>
      ) : (
        <ul className="flex max-h-[400px] flex-col overflow-y-auto pr-1 font-mono text-xs">
          {[...items].reverse().map((r) => (
            <li key={r.id} className="enter flex h-8 items-center gap-4 rounded px-2 odd:bg-white/[0.02]">
              <span className="w-10 text-right tabular-nums text-fg-3">#{r.seq}</span>
              <span className="w-40 truncate text-fg">{r.type}</span>
              <span className="truncate text-fg-3">{r.hash}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// -------------------------------------------------------------- primitives

/** The wordmark's mark: one flat diamond in the accent, the same as the favicon. */
function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-canvas" />
      <path d="M16 7 25 16 16 25 7 16Z" className="fill-accent" />
    </svg>
  );
}

function Badge({ tone, children }: { tone: "allow" | "deny" | "warn"; children: React.ReactNode }) {
  const cls = { allow: "bg-ok/15 text-ok", deny: "bg-bad/15 text-bad", warn: "bg-warn/15 text-warn" }[tone];
  return <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-[13px] text-fg-3">{children}</p>;
}

function short(s: string, n = 6) {
  return s.length > n * 2 + 2 ? `${s.slice(0, n + 2)}…${s.slice(-4)}` : s;
}

function timeAgo(iso: string | number) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s} seconds ago`;
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  return `${Math.round(s / 3600)} hours ago`;
}
