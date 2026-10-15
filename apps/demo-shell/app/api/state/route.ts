import { snapshot } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await snapshot());
}
