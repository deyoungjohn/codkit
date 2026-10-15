import { requireSession } from "@/lib/auth";
import { sseHandler } from "@codkit/feed";
import { runtime } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  return sseHandler(runtime().feed)(req);
}
