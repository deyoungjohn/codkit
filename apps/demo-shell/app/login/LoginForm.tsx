"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AuthMode } from "@/lib/auth";

export function LoginForm({ mode, next }: { mode: AuthMode; next: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
    setBusy(false);
    if (r.ok) return router.replace(next);
    setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "sign-in failed");
  };

  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(60%_50%_at_50%_100%,rgba(124,58,237,0.18),transparent_70%),#09090d] px-4">
      <div className="relative w-full max-w-[420px] rounded-[26px] border border-violet-300/15 bg-[linear-gradient(180deg,#121019,#0d0c13)] p-8">
        <div aria-hidden className="pointer-events-none absolute -inset-x-10 -bottom-16 top-1/2 -z-10 rounded-full bg-violet-600/20 blur-3xl" />
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-[#0b0a10]">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden>
              <path d="M4 7.5 12 3l8 4.5-8 4.5-8-4.5Z" opacity=".55" />
              <path d="M4 12l8 4.5 8-4.5v4.5L12 21l-8-4.5V12Z" />
            </svg>
          </span>
          <div className="leading-tight">
            <p className="text-[17px] text-white">codkit</p>
            <p className="text-xs text-white/45">Agent Console</p>
          </div>
        </div>
        <h1 className="mt-8 text-[28px] font-medium tracking-tight text-white">Sign in</h1>

        {mode === "locked" ? (
          <div className="mt-4 rounded-2xl border border-amber-300/25 bg-amber-300/[0.06] p-4 text-sm leading-relaxed text-amber-100/90">
            This dashboard is locked because no operator password is set. It controls an agent that can spend money, so production requires one. Set{" "}
            <code className="rounded bg-black/30 px-1">DASHBOARD_PASSWORD</code> and restart.
          </div>
        ) : mode === "open" ? (
          <p className="mt-3 text-sm text-white/55">Auth is off in development (no DASHBOARD_PASSWORD). <a href="/" className="text-violet-200 underline">Open the dashboard</a>.</p>
        ) : (
          <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
            <label className="text-[13px] text-white/55" htmlFor="password">
              Operator password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3.5 text-[15px] text-white outline-none transition focus:border-violet-300/50"
            />
            {error && <p className="text-sm text-rose-300">{error}</p>}
            <button
              disabled={busy || !password}
              className="mt-2 rounded-2xl bg-violet-300 px-4 py-3.5 text-[16px] font-medium text-[#17112b] shadow-[0_0_30px_rgba(167,139,250,0.35)] transition hover:bg-violet-200 disabled:opacity-40"
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}
        <p className="mt-6 text-xs leading-relaxed text-white/35">Sessions last 12 hours. The agent&apos;s spending limits apply whoever is signed in.</p>
      </div>
    </main>
  );
}
