import { authMode, checkPassword, createSession, loginThrottle, sameOrigin, sessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (authMode() !== "password") return Response.json({ error: "password sign-in is not configured (set DASHBOARD_PASSWORD)" }, { status: 503 });
  if (!sameOrigin(req)) return Response.json({ error: "cross-origin request refused" }, { status: 403 });
  const t = loginThrottle(req);
  if (t.blocked) return Response.json({ error: "too many attempts, try again later" }, { status: 429, headers: { "retry-after": String(t.retryAfter) } });
  const { password } = (await req.json().catch(() => ({}))) as { password?: unknown };
  if (!checkPassword(password)) {
    t.fail();
    return Response.json({ error: "wrong password" }, { status: 401 });
  }
  t.reset();
  const s = createSession();
  return Response.json({ ok: true }, { headers: { "set-cookie": sessionCookie(req, s.value, s.maxAge) } });
}
