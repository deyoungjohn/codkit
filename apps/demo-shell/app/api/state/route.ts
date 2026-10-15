import { requireSession } from "@/lib/auth";
import { snapshot } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = requireSession(req);
  if (denied) return denied;
  return Response.json(await snapshot());
}
