/**
 * Operator auth for the dashboard: one password (DASHBOARD_PASSWORD) → a signed,
 * expiring session cookie. Checked optimistically in `proxy.ts` and again in every
 * API route (the routes are the real gate; see Next's authentication guide).
 *
 *   DASHBOARD_PASSWORD  required in production; without it the dashboard stays locked
 *   SESSION_SECRET      optional (≥ 32 chars); otherwise derived from the password,
 *                       so changing the password signs everyone out
 *
 * Without DASHBOARD_PASSWORD in development the dashboard is open (and says so).
 */
import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";

export const SESSION_COOKIE = "codkit_session";
const SESSION_HOURS = 12;

export type AuthMode = "password" | "open" | "locked";

export function authMode(): AuthMode {
  if (process.env.DASHBOARD_PASSWORD) return "password";
  return process.env.NODE_ENV === "production" ? "locked" : "open";
}

function secret(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return Buffer.from(s);
  // deterministic, so the proxy and every route bundle agree without shared state
  return createHmac("sha256", "codkit-dashboard-session-v1").update(process.env.DASHBOARD_PASSWORD ?? "").digest();
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function createSession(now = Date.now()): { value: string; maxAge: number } {
  const exp = now + SESSION_HOURS * 3600_000;
  const payload = `v1.${exp}.${randomBytes(12).toString("base64url")}`;
  return { value: `${payload}.${sign(payload)}`, maxAge: SESSION_HOURS * 3600 };
}

export function verifySession(value: string | undefined, now = Date.now()): boolean {
  if (!value) return false;
  const i = value.lastIndexOf(".");
  if (i < 0) return false;
  const payload = value.slice(0, i);
  const [v, exp] = payload.split(".");
  if (v !== "v1" || !(Number(exp) > now)) return false;
  const a = Buffer.from(value.slice(i + 1)), b = Buffer.from(sign(payload));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function checkPassword(input: unknown): boolean {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected || typeof input !== "string") return false;
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(input), h(expected));
}

export function readCookie(req: Request, name = SESSION_COOKIE): string | undefined {
  const m = (req.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : undefined;
}

export function sessionCookie(req: Request, value: string, maxAge: number): string {
  const secure = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

/** Same-origin check for state-changing requests (defence in depth on top of SameSite=Strict). */
export function sameOrigin(req: Request): boolean {
  if (req.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients; the session cookie still has to be valid
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Gate for API route handlers: `const denied = requireSession(req); if (denied) return denied;`
 * Returns a 401/403/503 response, or null when the request may proceed.
 */
export function requireSession(req: Request): Response | null {
  const mode = authMode();
  if (mode === "locked") return Response.json({ error: "dashboard is locked: set DASHBOARD_PASSWORD" }, { status: 503 });
  if (req.method !== "GET" && req.method !== "HEAD" && !sameOrigin(req)) return Response.json({ error: "cross-origin request refused" }, { status: 403 });
  if (mode === "open") return null;
  return verifySession(readCookie(req)) ? null : Response.json({ error: "sign in required" }, { status: 401 });
}

// ------------------------------------------------------------- login throttling

const attempts = ((globalThis as unknown as { __codkitLogin?: Map<string, { n: number; until: number }> }).__codkitLogin ??= new Map());
const WINDOW_MS = 5 * 60_000;
const MAX_ATTEMPTS = 10;

/** Allows MAX_ATTEMPTS failed logins per client per 5 minutes. */
export function loginThrottle(req: Request) {
  const key = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  const now = Date.now();
  const e = attempts.get(key);
  const entry = e && e.until > now ? e : { n: 0, until: now + WINDOW_MS };
  return {
    blocked: entry.n >= MAX_ATTEMPTS,
    retryAfter: Math.ceil((entry.until - now) / 1000),
    fail: () => attempts.set(key, { n: entry.n + 1, until: entry.until }),
    reset: () => attempts.delete(key),
  };
}
