import { runtime } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { requestId, approved, by } = (await req.json().catch(() => ({}))) as { requestId?: string; approved?: boolean; by?: string };
  if (!requestId || typeof approved !== "boolean") return Response.json({ error: "requestId and approved required" }, { status: 400 });
  const ok = runtime().approvals.resolve(requestId, approved, by ?? "dashboard");
  return Response.json({ ok }, { status: ok ? 200 : 404 });
}
