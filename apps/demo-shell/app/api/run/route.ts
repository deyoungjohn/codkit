import { requireSession } from "@/lib/auth";
import { DEFAULT_PROMPT, startRun } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { prompt?: string };
  const prompt = (body.prompt ?? "").trim() || DEFAULT_PROMPT;
  if (prompt.length > 4000) return Response.json({ error: "prompt too long" }, { status: 400 });
  const res = startRun(prompt);
  return Response.json(res, { status: res.started ? 202 : 409 });
}
