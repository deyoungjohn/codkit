import { sseHandler } from "@codkit/feed";
import { runtime } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return sseHandler(runtime().feed)(req);
}
