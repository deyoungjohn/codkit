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
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (r.ok) return router.replace(next);
    setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "sign-in failed");
  };

  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4">
      <div className="w-full max-w-[400px] rounded-2xl border border-line bg-card p-8">
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden>
            <rect width="32" height="32" rx="8" className="fill-canvas" />
            <path d="M16 7 25 16 16 25 7 16Z" className="fill-accent" />
          </svg>
          <p className="text-base font-medium text-fg">codkit</p>
          <p className="text-[13px] text-fg-3">Agent console</p>
        </div>
        <h1 className="mt-8 text-[28px] font-medium leading-[1.15] text-fg">Sign in</h1>

        {mode === "locked" ? (
          <div className="mt-4 rounded-xl border border-warn/40 bg-warn/[0.06] p-4 text-sm leading-relaxed text-fg-2">
            This dashboard is locked because no operator password is set. It controls an agent that can spend money, so production requires
            one. Set <code className="rounded bg-raised px-1 font-mono text-xs text-fg">DASHBOARD_PASSWORD</code> and restart.
          </div>
        ) : mode === "open" ? (
          <p className="mt-3 text-sm text-fg-2">
            Auth is off in development (no DASHBOARD_PASSWORD).{" "}
            <a href="/" className="text-accent underline underline-offset-4">
              Open the dashboard
            </a>
            .
          </p>
        ) : (
          <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-[13px] text-fg-2" htmlFor="password">
                Operator password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                enterKeyHint="go"
                // biome-ignore lint/a11y/noAutofocus: the page has one field and exists only to fill it
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!error}
                aria-describedby={error ? "password-error" : undefined}
                className="h-10 rounded-lg border border-line bg-raised px-4 text-sm text-fg outline-none transition-colors duration-150 hover:border-line-strong focus-visible:border-accent aria-[invalid=true]:border-bad"
              />
              {error && (
                <p id="password-error" role="alert" className="text-[13px] text-bad">
                  {error}
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={busy || !password}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-fg px-5 text-sm font-medium text-canvas shadow-[inset_0_1px_0_rgb(255_255_255/0.12)] transition-colors duration-150 hover:bg-white active:scale-[0.98] disabled:opacity-40 disabled:hover:bg-fg"
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}
        <p className="mt-6 text-xs leading-relaxed text-fg-3">
          Sessions last 12 hours. The agent&apos;s spending limits apply whoever is signed in.
        </p>
      </div>
    </main>
  );
}
