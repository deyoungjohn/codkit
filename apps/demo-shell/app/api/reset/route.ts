import { requireSession } from "@/lib/auth";
import { resetRuntime, runtime } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  if (runtime().running) return Response.json({ error: "a run is in progress" }, { status: 409 });
  resetRuntime();
  return Response.json({ ok: true });
}
