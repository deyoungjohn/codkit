import { authMode } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <LoginForm mode={authMode()} next={next?.startsWith("/") && !next.startsWith("//") ? next : "/"} />;
}
