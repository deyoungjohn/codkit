import { sameOrigin, sessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "cross-origin request refused" }, { status: 403 });
  return Response.json({ ok: true }, { headers: { "set-cookie": sessionCookie(req, "", 0) } });
}
