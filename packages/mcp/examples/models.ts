/**
 * List the models each configured provider offers (GET /models), so you can
 * pick a free one with tool calling and set LLM_MODEL / <NAME>_MODEL.
 *
 *   GROQ_API_KEY=… OPENROUTER_API_KEY=… pnpm --filter @codkit/mcp example:models [filter]
 */
import { PROVIDERS, type ProviderName } from "../src/agent.js";

const filter = process.argv[2]?.toLowerCase();
const configured = (Object.keys(PROVIDERS) as ProviderName[]).filter((n) => process.env[PROVIDERS[n].keyEnv]);
if (!configured.length) console.log(`No keys set. Set any of: ${Object.values(PROVIDERS).map((p) => p.keyEnv).join(", ")}`);

for (const name of configured) {
  const p = PROVIDERS[name];
  const r = await fetch(`${p.baseUrl}/models`, { headers: { authorization: `Bearer ${process.env[p.keyEnv]}` } });
  if (!r.ok) {
    console.log(`\n${name}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    continue;
  }
  const { data = [] } = (await r.json()) as { data?: { id: string; supported_parameters?: string[] }[] };
  const rows = data
    .filter((m) => !filter || m.id.toLowerCase().includes(filter))
    // OpenRouter reports tool support; elsewhere assume and let the call fail over
    .filter((m) => name !== "openrouter" || m.supported_parameters?.includes("tools"))
    .map((m) => m.id.replace(/^models\//, ""))
    .sort();
  console.log(`\n${name} (${rows.length})${"model" in p ? ` default: ${p.model}` : ""}`);
  for (const id of rows) console.log(`  ${id}`);
}
