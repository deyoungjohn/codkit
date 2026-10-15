"use client";

import type { FeedEvent } from "@codkit/feed";
import { useEffect, useMemo, useRef, useState } from "react";
import { post, useFeed, useSnapshot, useWallet } from "./hooks";
import { Icon } from "./icons";

type Of<K extends FeedEvent["kind"]> = Extract<FeedEvent, { kind: K }>;
type Tab = "trace" | "decisions" | "payments" | "receipts";

const DEFAULT_PROMPT =
  "Get current ETH and SOL prices from the data vendor, then the market summary. If the full market report fits the budget, buy it too; otherwise explain why not.";
const REPO = "https://github.com/deyoungjohn/codkit";

const usdc = (label: string) => Number(/(\d+(?:\.\d+)?)\s*USDC/.exec(label)?.[1] ?? 0);
const cumulative = (xs: number[]) => xs.reduce<number[]>((acc, x) => [...acc, (acc.at(-1) ?? 0) + x], [0]);
const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export function Dashboard() {
  const { events, connected, clear } = useFeed();
  const lastId = events.at(-1)?.id ?? 0;
  const { snap, refresh } = useSnapshot(lastId);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [tab, setTab] = useState<Tab>("trace");

  const by = useMemo(() => {
    const pick = <K extends FeedEvent["kind"]>(...kinds: K[]) => events.filter((e): e is Of<K> => (kinds as string[]).includes(e.kind));
    const answered = new Set(pick("approval").map((a) => a.requestId).filter(Boolean));
    const decisions = pick("policy", "approval");
    const txs = pick("tx");
    return {
      trace: pick("thinking", "message", "tool_call", "tool_result", "status"),
      decisions,
      txs,
      receipts: pick("receipt"),
      pending: pick("approval_request").filter((r) => !answered.has(r.requestId) && snap?.pendingApprovals.some((p) => p.requestId === r.requestId)),
      spendSeries: cumulative(txs.map((t) => usdc(t.label))),
      paySeries: cumulative(txs.map(() => 1)),
      blockSeries: cumulative(decisions.filter((d) => d.kind === "policy").map((d) => (d.kind === "policy" && d.verdict === "deny" ? 1 : 0))),
    };
  }, [events, snap]);

  const blocked = by.decisions.filter((d) => d.kind === "policy" && d.verdict === "deny").length;
  const running = snap?.running ?? false;
  const spent = Number(snap?.budget.spent ?? 0);
  const perDay = Number(snap?.budget.perDay ?? 0);
  const usedPct = perDay ? Math.min(100, Math.round((spent / perDay) * 100)) : 0;
  const lastAt = events.at(-1)?.ts;

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
    await post("/api/kill", { engaged: !snap?.killed });
    void refresh();
  };
  const goto = (t: Tab) => {
    setTab(t);
    document.getElementById("session")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="flex min-h-screen">
      <Sidebar mode={snap?.mode} txs={by.txs} killed={snap?.killed ?? false} onKill={toggleKill} tab={tab} onNav={goto} />

      <main className="min-w-0 flex-1">
        <TopBar mode={snap?.mode} auth={snap?.auth} running={running} killed={snap?.killed ?? false} onRun={run} connected={connected} pending={by.pending.length} />

        <div className="flex flex-col gap-6 px-5 pb-10 pt-6 sm:px-8">
          {by.pending.length > 0 && <Approvals items={by.pending} onDone={refresh} />}

          {/* ---------------------------------------------------- budget */}
          <section className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_minmax(340px,400px)]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="flex items-center gap-2 text-[13px] text-white/55">
                    Spending under policy, settled in USDC <Icon.Clock className="h-3.5 w-3.5 text-violet-300" />
                    <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-xs text-white/70">Base Sepolia</span>
                  </p>
                  <h1 className="mt-1.5 text-[32px] font-medium tracking-tight text-white">Agent Budget</h1>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Chip>24H</Chip>
                  <Chip>x402</Chip>
                  <Chip>{snap?.mode === "live" ? (snap.llm ?? "LLM") : "Scripted agent"}</Chip>
                </div>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <MetricCard
                  icon={<Icon.Coin className="h-5 w-5" />}
                  tile="bg-violet-400/90 text-[#1b1530]"
                  kicker="Spent today"
                  title="USDC budget"
                  label="Of the daily cap"
                  value={fmt(spent)}
                  unit="USDC"
                  delta={`${usedPct}%`}
                  deltaTone={usedPct >= 80 ? "down" : "up"}
                  series={by.spendSeries}
                  tag={by.spendSeries.length > 1 ? `+$${fmt(by.spendSeries.at(-1) ?? 0)} settled` : undefined}
                  onOpen={() => goto("payments")}
                />
                <MetricCard
                  icon={<Icon.Check className="h-5 w-5" />}
                  tile="bg-amber-300 text-[#2a1d05]"
                  kicker="x402 payments"
                  title="Settled"
                  label="Payments"
                  value={String(snap?.payments ?? 0)}
                  delta={`${by.txs.length} this run`}
                  deltaTone="up"
                  series={by.paySeries}
                  tag={by.paySeries.length > 1 ? `${by.txs.length} tx` : undefined}
                  onOpen={() => goto("payments")}
                />
                <MetricCard
                  icon={<Icon.Shield className="h-5 w-5" />}
                  tile="bg-fuchsia-500 text-white"
                  kicker="Policy engine"
                  title="Blocked"
                  label="Refused before signing"
                  value={String(blocked)}
                  delta={`${by.decisions.length} checks`}
                  deltaTone={blocked ? "down" : "up"}
                  series={by.blockSeries}
                  tone={blocked ? "red" : "violet"}
                  tag={blocked ? `-${blocked} blocked` : undefined}
                  onOpen={() => goto("decisions")}
                />
              </div>
            </div>

            <PolicyCard snap={snap} killed={snap?.killed ?? false} onKill={toggleKill} />
          </section>

          {/* --------------------------------------------------- session */}
          <section id="session" className="scroll-mt-6 rounded-[28px] border border-white/[0.06] bg-[#0c0c11] p-3 sm:p-4">
            <div className="flex items-center justify-between px-3 pb-3 pt-1">
              <h2 className="text-[15px] text-white/90">Your agent session</h2>
              <div className="flex items-center gap-1 text-white/60">
                <IconButton label="Receipts" onClick={() => goto("receipts")}>
                  <Icon.Chart className="h-[18px] w-[18px]" />
                </IconButton>
                <IconButton label="Run agent" onClick={run} disabled={running || snap?.killed}>
                  <Icon.Plus className="h-[18px] w-[18px]" />
                </IconButton>
                <IconButton label="Reset" onClick={reset} disabled={running}>
                  <Icon.Refresh className="h-[18px] w-[18px]" />
                </IconButton>
                <IconButton label="Decisions" onClick={() => goto("decisions")}>
                  <Icon.Filter className="h-[18px] w-[18px]" />
                </IconButton>
              </div>
            </div>

            <div className="rounded-[22px] border border-white/[0.06] bg-[radial-gradient(120%_120%_at_0%_0%,rgba(139,92,246,0.07),transparent_45%),#0f0f15] p-5 sm:p-7">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,480px)]">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-[13px] text-white/55">
                    Last update ~ {lastAt ? timeAgo(lastAt) : "no activity yet"} <Icon.Clock className="h-3.5 w-3.5 text-violet-300" />
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <h3 className="text-[30px] font-medium tracking-tight text-white sm:text-[34px]">Research Agent</h3>
                    <span className="grid h-9 w-9 place-items-center rounded-lg bg-violet-400 text-[#1b1530]">
                      <Icon.Bolt className="h-5 w-5" />
                    </span>
                    <a href={REPO} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3.5 py-1.5 text-[13px] text-white/80 transition hover:bg-white/5">
                      View source <Icon.ArrowUpRight className="h-3.5 w-3.5" />
                    </a>
                  </div>
                  <label className="mt-4 block">
                    <span className="sr-only">Task</span>
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      rows={2}
                      className="w-full resize-none rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-3 text-sm leading-relaxed text-white/80 outline-none transition placeholder:text-white/30 focus:border-violet-300/40"
                    />
                  </label>
                  <p className="mt-5 text-[13px] text-white/50">Spent this session, USDC</p>
                  <div className="mt-1 flex flex-wrap items-center gap-4">
                    <BigNumber value={spent.toFixed(5)} />
                    <div className="flex gap-3">
                      <button
                        disabled={running || snap?.killed}
                        onClick={run}
                        className="rounded-xl bg-violet-300 px-6 py-3 text-[15px] font-medium text-[#17112b] shadow-[0_0_24px_rgba(167,139,250,0.35)] transition hover:bg-violet-200 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {running ? "Running…" : "Run agent"}
                      </button>
                      <button
                        disabled={running}
                        onClick={reset}
                        className="rounded-xl border border-white/12 px-6 py-3 text-[15px] text-white/85 transition hover:bg-white/5 disabled:opacity-40"
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                </div>

                <BudgetSlider spent={spent} perDay={perDay} approvalAbove={Number(snap?.budget.approvalAbove ?? 0)} />
              </div>

              <div className="mt-7 grid grid-cols-2 border-b border-white/[0.06] lg:grid-cols-4">
                {(
                  [
                    ["trace", "Reasoning", `${by.trace.length} steps`],
                    ["decisions", "Decisions", `${by.decisions.length} policy verdicts`],
                    ["payments", "Payments", `${by.txs.length} settlements`],
                    ["receipts", "Receipts", `${snap?.receipts.count ?? 0} signed`],
                  ] as const
                ).map(([key, title, sub]) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`flex items-center justify-between gap-3 border-b-2 px-1 py-3 text-left transition ${tab === key ? "border-violet-300" : "border-transparent hover:border-white/15"}`}
                  >
                    <span>
                      <span className={`block text-[15px] ${tab === key ? "text-white" : "text-white/75"}`}>{title}</span>
                      <span className="block text-xs text-white/40">{sub}</span>
                    </span>
                    <Icon.Updown className="mr-2 h-4 w-4 text-white/45" />
                  </button>
                ))}
              </div>

              <div className="pt-5">
                {tab === "trace" && <Trace items={by.trace} />}
                {tab === "decisions" && <Decisions items={by.decisions} />}
                {tab === "payments" && <Txs items={by.txs} />}
                {tab === "receipts" && (
                  <Receipts items={by.receipts} head={snap?.receipts.head ?? null} signer={snap?.receipts.signer ?? ""} ok={snap?.receipts.ok ?? true} />
                )}
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MiniStat label="Per-payment cap" pill="x402" value={snap ? fmt(Number(snap.budget.perTx ?? 0)) : "–"} unit="USDC" />
                <MiniStat label="Approval above" pill="Human" value={snap ? fmt(Number(snap.budget.approvalAbove ?? 0)) : "–"} unit="USDC" />
                <MiniStat
                  label="Receipt log"
                  pill={snap?.receipts.ok === false ? "Invalid" : "Verified"}
                  value={String(snap?.receipts.count ?? 0)}
                  unit="entries"
                  hint={snap?.receipts.head ? short(snap.receipts.head, 8) : undefined}
                />
                <RatesCard spent={spent} perDay={perDay} perTx={Number(snap?.budget.perTx ?? 0)} approval={Number(snap?.budget.approvalAbove ?? 0)} />
              </div>
            </div>
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
  const recent = [...txs].reverse().slice(0, 4);
  const nav: [Tab | null, string, (p: { className?: string }) => React.ReactNode, string?][] = [
    [null, "Dashboard", Icon.Grid],
    ["trace", "Reasoning", Icon.Sparkle],
    ["decisions", "Policy decisions", Icon.Shield],
    ["payments", "Payments", Icon.Coin],
    ["receipts", "Receipt log", Icon.Receipt],
  ];
  return (
    <aside className="sticky top-0 hidden h-screen w-[300px] shrink-0 flex-col border-r border-white/[0.06] bg-[#08080c] lg:flex">
      <div className="flex items-center gap-3 border-b border-white/[0.06] px-6 py-6">
        <Logo />
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-medium leading-tight text-white">codkit</p>
          <p className="text-xs text-white/45">Agent Console</p>
        </div>
        <Icon.Updown className="h-4 w-4 text-white/45" />
      </div>

      <div className="px-5 pt-5">
        <div className="grid grid-cols-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-1 text-[14px]">
          <span className={`rounded-xl py-2 text-center ${mode !== "live" ? "bg-white/[0.07] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" : "text-white/45"}`}>Demo</span>
          <span className={`rounded-xl py-2 text-center ${mode === "live" ? "bg-white/[0.07] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" : "text-white/45"}`}>Live LLM</span>
        </div>
      </div>

      <nav className="mt-4 border-t border-white/[0.06] px-3 pt-4">
        {nav.map(([key, label, Ico]) => {
          const active = key === null ? false : tab === key;
          return (
            <button
              key={label}
              onClick={() => (key ? onNav(key) : window.scrollTo({ top: 0, behavior: "smooth" }))}
              className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] transition ${
                key === null ? "bg-white/[0.06] text-white" : active ? "text-white" : "text-white/55 hover:bg-white/[0.03] hover:text-white/80"
              }`}
            >
              <Ico className="h-[18px] w-[18px]" />
              {label}
            </button>
          );
        })}
        <a href={`${REPO}#readme`} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] text-white/55 transition hover:bg-white/[0.03] hover:text-white/80">
          <Icon.Cube className="h-[18px] w-[18px]" /> Docs <Icon.ArrowUpRight className="h-3.5 w-3.5" />
        </a>
        <a href={`${REPO}/tree/main/packages/mcp`} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] text-white/55 transition hover:bg-white/[0.03] hover:text-white/80">
          <Icon.Plug className="h-[18px] w-[18px]" /> MCP server <span className="rounded-md bg-violet-300 px-2 py-0.5 text-[11px] font-medium text-[#1b1530]">Beta</span>
        </a>

        <button onClick={() => setOpen((o) => !o)} className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] text-white">
          <Icon.Stack className="h-[18px] w-[18px]" /> Recent payments
          <span className="rounded-md bg-violet-300/90 px-2 py-0.5 text-[11px] font-medium text-[#1b1530]">{txs.length}</span>
          <Icon.Caret className={`ml-auto h-3 w-3 text-white/60 transition ${open ? "" : "rotate-180"}`} />
        </button>
        {open && (
          <ul className="mt-1 flex flex-col gap-3 px-3 pb-2">
            {recent.length === 0 && <li className="text-[13px] text-white/35">No payments yet. Run the agent.</li>}
            {recent.map((t, i) => (
              <li key={t.id} className={`flex items-center gap-3 ${i === 3 ? "opacity-35" : ""}`}>
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${["bg-violet-400/90 text-[#1b1530]", "bg-rose-500 text-white", "bg-fuchsia-500 text-white", "bg-sky-500 text-white"][i % 4]}`}>
                  <Icon.Coin className="h-4 w-4" />
                </span>
                <span className="min-w-0 text-[13px] leading-tight">
                  <span className="block truncate text-violet-200/80">Payment {t.url ? "onchain" : "· simulated"}</span>
                  <span className="block text-white/85">Amount ${fmt(usdc(t.label))}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </nav>

      <div className="mt-auto border-t border-white/[0.06] p-5">
        <button
          onClick={onKill}
          className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${
            killed ? "border-emerald-300/30 bg-emerald-300/[0.06] hover:bg-emerald-300/10" : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]"
          }`}
        >
          <Icon.Bolt className={`h-5 w-5 ${killed ? "text-emerald-300" : "text-white"}`} />
          <span className="leading-tight">
            <span className="block text-[15px] text-white">{killed ? "Release kill switch" : "Kill switch"}</span>
            <span className="block text-xs text-white/50">{killed ? "Spending is halted" : "Stop all agent spending"}</span>
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
    <header className="flex flex-wrap items-center gap-4 border-b border-white/[0.06] px-5 py-5 sm:px-8">
      <div className="flex items-center gap-3 lg:hidden">
        <Logo />
      </div>
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-[conic-gradient(from_200deg,#c4b5fd,#f0abfc,#93c5fd,#c4b5fd)] p-[2px]">
          <span className="grid h-full w-full place-items-center rounded-full bg-[#17141f] text-sm font-medium text-violet-200">RA</span>
        </span>
        <div className="leading-tight">
          <p className="flex items-center gap-1.5 text-xs text-white/45">
            @research-agent <span className="rounded bg-white/10 px-1.5 py-px text-[10px] font-medium text-white/80">{mode === "live" ? "LIVE" : "DEMO"}</span>
          </p>
          <p className="text-[16px] text-white">Research Agent</p>
        </div>
      </div>
      <span className="mx-2 hidden h-10 w-px bg-white/[0.08] sm:block" />
      <button
        onClick={onRun}
        disabled={running || killed}
        className="flex items-center gap-2 rounded-xl bg-violet-300 px-4 py-2.5 text-[15px] font-medium text-[#17112b] transition hover:bg-violet-200 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {running ? "Running…" : "Run agent"} <Icon.Play className="h-4 w-4" />
      </button>

      <div className="ml-auto flex items-center gap-2.5">
        <span className="relative grid h-10 w-10 place-items-center rounded-full border border-white/10 text-white/80" title={`${pending} approval(s) pending`}>
          <Icon.Bell className="h-[18px] w-[18px]" />
          {pending > 0 && <span className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-violet-300 px-1 text-[11px] font-semibold text-[#1b1530]">{pending}</span>}
        </span>
        <span className="flex items-center gap-2 rounded-xl border border-white/10 px-3.5 py-2.5 text-[13px] text-white/75">
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" : "bg-rose-400"}`} />
          {connected ? "Live feed" : "Feed offline"}
        </span>
        <WalletButton />
        {auth === "open" && (
          <span className="rounded-xl border border-amber-300/30 px-3 py-2.5 text-[13px] text-amber-200" title="Set DASHBOARD_PASSWORD to require sign-in">
            Auth off (dev)
          </span>
        )}
        {auth === "password" && (
          <button
            onClick={async () => {
              await fetch("/api/logout", { method: "POST" });
              window.location.href = "/login";
            }}
            className="rounded-xl border border-white/10 px-3.5 py-2.5 text-[13px] text-white/70 transition hover:bg-white/5 hover:text-white"
          >
            Sign out
          </button>
        )}
      </div>
    </header>
  );
}

function WalletButton({ variant = "outline" }: { variant?: "outline" | "solid" }) {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const base =
    variant === "solid"
      ? "flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-300 px-4 py-3.5 text-[16px] font-medium text-[#17112b] shadow-[0_0_30px_rgba(167,139,250,0.35)] transition hover:bg-violet-200"
      : "flex items-center gap-2 rounded-xl border border-white/10 px-3.5 py-2.5 text-[13px] text-white/80 transition hover:bg-white/5";
  if (w.account) {
    return (
      <button onClick={w.disconnect} className={`${base} font-mono`} title="Disconnect">
        {short(w.account)} · {w.chainId === 84532 ? "Base Sepolia" : `chain ${w.chainId}`}
      </button>
    );
  }
  return (
    <div className={`relative ${variant === "solid" ? "w-full" : ""}`}>
      <button onClick={() => setOpen((o) => !o)} className={base}>
        {variant === "solid" ? "Connect with Wallet" : "Connect wallet"} <Icon.Wallet className="h-[18px] w-[18px]" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-60 rounded-2xl border border-white/10 bg-[#141220] p-1.5 shadow-2xl">
          {w.providers.length === 0 && <p className="p-2.5 text-xs text-white/50">No browser wallet detected.</p>}
          {w.providers.map((p) => (
            <button
              key={p.info.uuid}
              onClick={() => {
                setOpen(false);
                void w.connect(p);
              }}
              className="flex w-full items-center gap-2 rounded-xl p-2.5 text-left text-sm text-white hover:bg-white/5"
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

// ------------------------------------------------------------ hero pieces

function MetricCard(p: {
  icon: React.ReactNode;
  tile: string;
  kicker: string;
  title: string;
  label: string;
  value: string;
  unit?: string;
  delta: string;
  deltaTone: "up" | "down";
  series: number[];
  tone?: "violet" | "red";
  tag?: string;
  onOpen: () => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-[22px] border border-white/[0.06] bg-[linear-gradient(180deg,#121219,#0d0d12)] pt-5">
      <div className="flex items-start gap-3 px-5">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${p.tile}`}>{p.icon}</span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13px] text-white/50">{p.kicker}</p>
          <p className="truncate text-[16px] text-white">{p.title}</p>
        </div>
        <button onClick={p.onOpen} aria-label={`Open ${p.title}`} className="grid h-10 w-10 place-items-center rounded-full border border-white/10 text-white/80 transition hover:bg-white/5">
          <Icon.ArrowUpRight className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-6 px-5 text-[13px] text-white/45">{p.label}</p>
      <p className="mt-1 px-5 text-[38px] font-medium leading-none tracking-tight text-white tabular-nums">
        {p.value}
        {p.unit && <span className="ml-1 text-[20px] text-white/80">{p.unit}</span>}
      </p>
      <p className={`mt-3 flex items-center gap-1.5 px-5 text-[13px] ${p.deltaTone === "up" ? "text-emerald-400" : "text-rose-400"}`}>
        <span className={`grid h-4 w-4 place-items-center rounded-full ${p.deltaTone === "up" ? "bg-emerald-400" : "bg-rose-400"} text-[#0d0d12]`}>
          {p.deltaTone === "up" ? <Icon.Up className="h-2.5 w-2.5" /> : <Icon.X className="h-2.5 w-2.5" />}
        </span>
        {p.delta}
      </p>
      <Sparkline values={p.series} tone={p.tone ?? "violet"} tag={p.tag} />
    </div>
  );
}

/** Smooth line with a glow, a dashed baseline, dots on the last points and a value tag. */
function Sparkline({ values, tone, tag }: { values: number[]; tone: "violet" | "red"; tag?: string }) {
  const W = 320, H = 96, pad = 10;
  const flat = values.length > 1 && Math.max(...values) === Math.min(...values);
  const pts = values.length > 1 && !flat ? values : [0, 0.15, 0.05, 0.2, 0.1];
  const max = Math.max(...pts), min = Math.min(...pts);
  const xy = flat
    ? values.map((_, i) => [(i / (values.length - 1)) * W, H * 0.62] as const) // nothing happened yet: rest on the baseline
    : pts.map((v, i) => [(i / (pts.length - 1)) * W, H - pad - ((v - min) / (max - min || 1)) * (H - pad * 3)] as const);
  // Catmull-Rom → cubic Bézier for a soft curve
  let d = `M ${xy[0]![0]} ${xy[0]![1]}`;
  for (let i = 0; i < xy.length - 1; i++) {
    const p0 = xy[i - 1] ?? xy[i]!, p1 = xy[i]!, p2 = xy[i + 1]!, p3 = xy[i + 2] ?? p2;
    d += ` C ${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6}, ${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6}, ${p2[0]} ${p2[1]}`;
  }
  const c = tone === "red" ? ["#ef4444", "#f87171"] : ["#7c3aed", "#c4b5fd"];
  const id = `g${tone}${values.length}`;
  const last = xy.at(-1)!, prev = xy.at(-2)!;
  const empty = values.length <= 1 || flat;
  return (
    <div className="relative mt-3 h-[96px]">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <linearGradient id={`${id}s`} x1="0" x2="1">
            <stop offset="0" stopColor={c[0]} stopOpacity="0.55" />
            <stop offset="1" stopColor={c[1]} />
          </linearGradient>
          <linearGradient id={`${id}a`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={c[1]} stopOpacity="0.16" />
            <stop offset="1" stopColor={c[1]} stopOpacity="0" />
          </linearGradient>
          <filter id={`${id}f`} x="-10%" y="-50%" width="120%" height="200%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        <line x1="0" x2={W} y1={H * 0.62} y2={H * 0.62} stroke="white" strokeOpacity="0.18" strokeDasharray="3 4" />
        {!empty && <path d={`${d} L ${W} ${H} L 0 ${H} Z`} fill={`url(#${id}a)`} />}
        <path d={d} fill="none" stroke={`url(#${id}s)`} strokeWidth="5" opacity={empty ? 0.12 : 0.45} filter={`url(#${id}f)`} />
        <path d={d} fill="none" stroke={`url(#${id}s)`} strokeWidth="2" opacity={empty ? 0.25 : 1} vectorEffect="non-scaling-stroke" />
      </svg>
      {!empty && (
        <span
          className="pointer-events-none absolute -bottom-4 -top-10 right-0 w-[45%]"
          style={{
            background: `radial-gradient(70% 60% at 70% 55%, ${tone === "red" ? "rgba(248,113,113,0.10)" : "rgba(167,139,250,0.12)"}, transparent 70%)`,
          }}
        />
      )}
      {!empty && (
        <>
          <Dot x={prev[0] / W} y={prev[1] / H} tone={tone} />
          <Dot x={last[0] / W} y={last[1] / H} tone={tone} />
        </>
      )}
      {tag && !empty && (
        <span
          className="absolute -translate-x-full -translate-y-[150%] whitespace-nowrap rounded-md bg-[#1a1823]/90 px-2 py-0.5 text-[12px] text-white/90 shadow-[0_0_0_1px_rgba(255,255,255,0.05)]"
          style={{ left: `${(last[0] / W) * 100 - 3}%`, top: `${(last[1] / H) * 100}%` }}
        >
          {tag}
        </span>
      )}
    </div>
  );
}

function Dot({ x, y, tone }: { x: number; y: number; tone: "violet" | "red" }) {
  return (
    <span
      className={`absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-[#0d0d12] ${tone === "red" ? "border-rose-400" : "border-violet-300"}`}
      style={{ left: `${Math.min(x, 0.985) * 100}%`, top: `${y * 100}%` }}
    />
  );
}

function PolicyCard({ snap, killed, onKill }: { snap: ReturnType<typeof useSnapshot>["snap"]; killed: boolean; onKill: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-[26px] border border-violet-300/20 bg-[linear-gradient(180deg,#0f0d17_0%,#1d1734_45%,#5b4bb7_100%)] p-7 shadow-[0_20px_60px_-20px_rgba(124,58,237,0.45)]">
      <Stars />
      <div className="relative flex items-center gap-3">
        <Logo small />
        <span className="text-[17px] text-white">codkit</span>
        <span className="ml-auto rounded-lg bg-violet-300 px-2.5 py-1 text-xs font-medium text-[#1b1530]">{killed ? "Halted" : "Active"}</span>
      </div>
      <div className="relative md:grid md:grid-cols-[minmax(0,1fr)_minmax(260px,340px)] md:items-end md:gap-10 2xl:block">
      <div>
      <h2 className="relative mt-7 text-[30px] font-medium leading-tight tracking-tight text-white">Spending Policy</h2>
      <p className="relative mt-3 max-w-[290px] text-[15px] leading-snug text-white/55 md:max-w-[460px] 2xl:max-w-[290px]">
        Every payment is checked before anything is signed: at most {snap?.budget.perTx ?? "–"} USDC each, {snap?.budget.perDay ?? "–"} USDC a day, and a human approves anything
        above {snap?.budget.approvalAbove ?? "–"}.
      </p>
      </div>
      <svg className="pointer-events-none absolute -right-2 top-[42%] hidden h-20 w-20 text-white/20 2xl:block" viewBox="0 0 100 100" fill="none">
        <path d="M5 95 L95 5" stroke="currentColor" strokeWidth="1" />
      </svg>
      <div className="relative mt-10 flex flex-col gap-3 md:mt-0 2xl:mt-10">
        <WalletButton variant="solid" />
        <button
          onClick={onKill}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/[0.04] px-4 py-3.5 text-[16px] text-white backdrop-blur transition hover:bg-white/[0.08]"
        >
          {killed ? "Release kill switch" : "Engage kill switch"} <Icon.Lock className="h-[18px] w-[18px]" />
        </button>
      </div>
      </div>
    </div>
  );
}

function Stars() {
  const dots = [
    [12, 30], [78, 22], [64, 48], [30, 62], [88, 58], [45, 40], [20, 78], [70, 70], [55, 15], [92, 35],
  ];
  return (
    <div className="pointer-events-none absolute inset-0">
      {dots.map(([x, y], i) => (
        <span key={i} className="absolute h-[2px] w-[2px] rounded-full bg-white/40" style={{ left: `${x}%`, top: `${y}%` }} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------- session pieces

function BigNumber({ value }: { value: string }) {
  const [int, frac = ""] = value.split(".");
  return (
    <p className="text-[64px] font-medium leading-none tracking-[-0.04em] tabular-nums sm:text-[76px]">
      <span className="text-white">{int}.</span>
      <span className="bg-[linear-gradient(90deg,#ffffff_0%,#ffffff_25%,rgba(255,255,255,0.35)_100%)] bg-clip-text text-transparent">{frac}</span>
    </p>
  );
}

function BudgetSlider({ spent, perDay, approvalAbove }: { spent: number; perDay: number; approvalAbove: number }) {
  const pct = perDay ? Math.min(1, spent / perDay) : 0;
  const ticks = Array.from({ length: 41 }, (_, i) => i);
  return (
    <div className="self-start rounded-[22px] border border-white/[0.07] bg-white/[0.015] p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[24px] tracking-tight text-white">Daily Budget</p>
          <p className="text-[13px] text-white/45">USDC available to the agent today</p>
        </div>
        <span className="rounded-lg bg-white/[0.07] px-2.5 py-1.5 text-[13px] text-white/85">{fmt(perDay)} USDC</span>
      </div>
      <div className="relative mt-12 h-10">
        <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center justify-between">
          {ticks.map((t) => (
            <span key={t} className={`w-px ${t % 5 === 0 ? "h-5 bg-white/25" : "h-2.5 bg-white/12"}`} />
          ))}
        </div>
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/15" />
        <div className="absolute left-0 top-1/2 h-[2px] -translate-y-1/2 bg-violet-300/80" style={{ width: `${pct * 100}%` }} />
        {perDay > 0 && approvalAbove > 0 && (
          <span className="absolute top-1/2 h-6 w-px -translate-y-1/2 bg-amber-300/70" style={{ left: `${(approvalAbove / perDay) * 100}%` }} title="approval threshold" />
        )}
        <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${pct * 100}%` }}>
          <span className="absolute bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-[#1b1925] px-2.5 py-1 text-[12px] text-white/90">
            {fmt(spent)} spent
          </span>
          <span className="grid h-7 w-7 place-items-center rounded-full border-2 border-violet-300 bg-[#25213a] shadow-[0_0_14px_rgba(167,139,250,0.6)]">
            <span className="flex gap-[2px]">
              <span className="h-2.5 w-[2px] rounded bg-violet-200" />
              <span className="h-2.5 w-[2px] rounded bg-violet-200" />
            </span>
          </span>
        </span>
      </div>
      <div className="mt-3 flex justify-between text-[11px] text-white/35">
        <span>0</span>
        <span className="text-amber-200/70">approval at {fmt(approvalAbove)}</span>
        <span>{fmt(perDay)}</span>
      </div>
    </div>
  );
}

function MiniStat({ label, pill, value, unit, hint }: { label: string; pill: string; value: string; unit?: string; hint?: string }) {
  return (
    <div className="rounded-[20px] border border-white/[0.07] bg-white/[0.015] p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] text-white/50">{label}</p>
        <span className="rounded-lg bg-white/[0.07] px-2.5 py-1 text-[12px] text-white/80">{pill}</span>
      </div>
      <p className="mt-3 text-[34px] font-medium leading-none tracking-tight text-white tabular-nums">
        {value}
        {unit && <span className="ml-1.5 text-[14px] text-white/45">{unit}</span>}
      </p>
      {hint && <p className="mt-2 truncate font-mono text-[11px] text-white/35">{hint}</p>}
    </div>
  );
}

function RatesCard({ spent, perDay, perTx, approval }: { spent: number; perDay: number; perTx: number; approval: number }) {
  const rows = [
    ["spent today", perDay ? spent / perDay : 0, `${fmt(spent)}`],
    ["needs approval", perTx ? approval / perTx : 0, `${fmt(approval)}`],
  ] as const;
  return (
    <div className="rounded-[20px] border border-white/[0.07] bg-white/[0.015] p-5">
      <p className="text-[13px] text-white/50">Limits in use</p>
      <div className="mt-4 flex flex-col gap-3">
        {rows.map(([name, f, v]) => (
          <div key={name} className="flex items-center gap-3">
            <div className="relative h-px flex-1 bg-white/15">
              <span className="absolute top-1/2 h-px bg-violet-300/70" style={{ width: `${Math.min(1, f) * 100}%` }} />
              <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-violet-200 bg-[#0f0f15]" style={{ left: `${Math.min(1, f) * 100}%` }} />
            </div>
            <span className="whitespace-nowrap text-right text-[13px] text-white/85 tabular-nums">
              {v} <span className="text-[10px] text-white/40">{name}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- tab panels

function Trace({ items }: { items: Of<"thinking" | "message" | "tool_call" | "tool_result" | "status">[] }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); // follow the agent
  }, [items.length]);
  if (!items.length) return <Empty>Run the agent to see its reasoning, tool calls and results here.</Empty>;
  return (
    <ol ref={ref} className="flex max-h-[400px] flex-col gap-2 overflow-y-auto pr-1">
      {items.map((e) => (
        <li key={e.id} className="enter">
          {e.kind === "thinking" && <p className="border-l-2 border-violet-300/40 pl-3 text-sm italic text-white/60">{e.text}</p>}
          {e.kind === "message" && <p className="whitespace-pre-wrap rounded-2xl border border-violet-300/15 bg-violet-300/[0.06] p-4 text-sm text-violet-50">{e.text}</p>}
          {e.kind === "tool_call" && (
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2 font-mono text-xs">
              <span className="text-violet-200">→ {e.name}</span> <span className="break-all text-white/45">{JSON.stringify(e.input)}</span>
            </div>
          )}
          {e.kind === "tool_result" && (
            <details className={`rounded-xl border px-3 py-2 font-mono text-xs ${e.ok ? "border-white/[0.07]" : "border-rose-400/30 bg-rose-500/[0.05]"}`}>
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
    <section className="enter relative overflow-hidden rounded-[22px] border border-amber-300/30 bg-[linear-gradient(90deg,rgba(251,191,36,0.08),rgba(167,139,250,0.06))] p-5">
      <p className="flex items-center gap-2 text-[15px] text-amber-100">
        <Icon.Bell className="h-4 w-4" /> Approval needed
      </p>
      {items.map((r) => (
        <div key={r.requestId} className="mt-3 flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-sm text-white">{r.summary}</p>
            <p className="text-xs text-white/50">{r.reasons.join("; ")}</p>
          </div>
          <button
            onClick={async () => {
              await post("/api/approve", { requestId: r.requestId, approved: true, by: "dashboard" });
              onDone();
            }}
            className="rounded-xl bg-violet-300 px-4 py-2 text-sm font-medium text-[#17112b] hover:bg-violet-200"
          >
            Approve
          </button>
          <button
            onClick={async () => {
              await post("/api/approve", { requestId: r.requestId, approved: false, by: "dashboard" });
              onDone();
            }}
            className="rounded-xl border border-white/15 px-4 py-2 text-sm text-white hover:bg-white/5"
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
        <li key={d.id} className="enter flex items-start gap-3 rounded-xl border border-white/[0.05] bg-white/[0.015] px-3 py-2.5 text-sm">
          {d.kind === "policy" ? (
            <>
              <Badge tone={d.verdict === "allow" ? "allow" : d.verdict === "deny" ? "deny" : "warn"}>
                {d.verdict === "require_approval" ? "approval" : d.verdict === "allow" ? "allowed" : "blocked"}
              </Badge>
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-white/85">{d.summary}</p>
                {d.reasons.length > 0 && <p className="text-xs text-white/50">{d.reasons.join("; ")}</p>}
              </div>
            </>
          ) : (
            <>
              <Badge tone={d.approved ? "allow" : "deny"}>{d.approved ? "approved" : "declined"}</Badge>
              <p className="min-w-0 truncate font-mono text-xs text-white/85">
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
    <ul className="flex max-h-[400px] flex-col gap-2 overflow-y-auto pr-1">
      {[...items].reverse().map((t) => (
        <li key={t.id} className="enter flex items-center gap-3 rounded-xl border border-white/[0.05] bg-white/[0.015] px-3 py-2.5 text-xs">
          <Badge tone="allow">{t.status}</Badge>
          <span className="min-w-0 flex-1 truncate font-mono text-white/85">{t.label}</span>
          {t.url ? (
            <a href={t.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-violet-200 hover:underline">
              {short(t.hash)} <Icon.ArrowUpRight className="h-3 w-3" />
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
      <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-white/50">
        <p>
          head <span className="font-mono text-white/85">{head ? short(head, 10) : "—"}</span>{" "}
          {head && <span className={ok ? "text-emerald-300" : "text-rose-300"}>{ok ? "chain verified" : "verification failed"}</span>}
        </p>
        <p className="truncate">
          signer <span className="font-mono text-white/70">{short(signer.replace(/^ed25519:/, ""), 10)}</span>
        </p>
      </div>
      {items.length === 0 ? (
        <Empty>Receipts are written for every decision, payment and note.</Empty>
      ) : (
        <ul className="flex max-h-[400px] flex-col gap-1 overflow-y-auto pr-1 font-mono text-xs">
          {[...items].reverse().map((r) => (
            <li key={r.id} className="enter flex gap-3 rounded-lg px-2 py-1.5 odd:bg-white/[0.015]">
              <span className="w-8 text-right text-white/35">#{r.seq}</span>
              <span className="w-40 truncate text-white/80">{r.type}</span>
              <span className="truncate text-white/40">{r.hash}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// -------------------------------------------------------------- primitives

function Logo({ small }: { small?: boolean }) {
  const s = small ? "h-7 w-7" : "h-10 w-10";
  return (
    <span className={`grid ${s} shrink-0 place-items-center rounded-xl bg-white text-[#0b0a10]`}>
      <svg viewBox="0 0 24 24" className={small ? "h-4 w-4" : "h-6 w-6"} fill="currentColor" aria-hidden>
        <path d="M4 7.5 12 3l8 4.5-8 4.5-8-4.5Z" opacity=".55" />
        <path d="M4 12l8 4.5 8-4.5v4.5L12 21l-8-4.5V12Z" />
      </svg>
    </span>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3.5 py-2 text-[13px] text-white/80">
      <Icon.Caret className="h-2.5 w-2.5 rotate-180 text-white/70" />
      {children}
    </span>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} disabled={disabled} className="grid h-9 w-9 place-items-center rounded-full transition hover:bg-white/5 hover:text-white disabled:opacity-30">
      {children}
    </button>
  );
}

function Badge({ tone, children }: { tone: "allow" | "deny" | "warn" | "neutral"; children: React.ReactNode }) {
  const cls = {
    allow: "bg-emerald-400/15 text-emerald-300",
    deny: "bg-rose-400/15 text-rose-300",
    warn: "bg-amber-400/15 text-amber-200",
    neutral: "bg-white/10 text-white/70",
  }[tone];
  return <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-[13px] text-white/35">{children}</p>;
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
