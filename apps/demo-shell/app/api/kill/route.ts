import { requireSession } from "@/lib/auth";
import { runtime } from "@/lib/runtime";

export const dynamic = "force-dynamic";

/** Human-only control: engage or release the kill switch. (The agent can only engage it.) */
export async function POST(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { engaged, reason } = (await req.json().catch(() => ({}))) as { engaged?: boolean; reason?: string };
  const { engine } = runtime();
  if (engaged === false) engine.resume();
  else engine.kill(reason ?? "operator pressed the kill switch");
  return Response.json({ killed: engine.isKilled });
}
