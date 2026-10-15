import { NextResponse, type NextRequest } from "next/server";
import { authMode, SESSION_COOKIE, verifySession } from "@/lib/auth";

/**
 * Optimistic gate: send signed-out visitors to /login before anything renders.
 * Every API route re-checks the session itself (lib/auth.ts `requireSession`).
 */
export function proxy(req: NextRequest) {
  const mode = authMode();
  if (mode === "open") return NextResponse.next();
  const ok = mode === "password" && verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (ok) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: mode === "locked" ? "dashboard is locked: set DASHBOARD_PASSWORD" : "sign in required" }, { status: mode === "locked" ? 503 : 401 });
  }
  const login = new URL("/login", req.url);
  if (req.nextUrl.pathname !== "/") login.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  // everything except the sign-in flow, the bearer-authenticated MCP endpoint and static assets
  matcher: ["/((?!login|api/login|api/logout|api/mcp|_next/static|_next/image|favicon.ico).*)"],
};
