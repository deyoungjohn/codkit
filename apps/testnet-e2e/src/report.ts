import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Step {
  name: string;
  ok: boolean;
  detail?: string;
  links?: string[];
  ms: number;
}

/** Collects pass/fail steps with explorer links and writes reports/<network>-<time>.{json,md}. */
export class Report {
  readonly steps: Step[] = [];
  private readonly started = new Date();

  constructor(readonly network: string, readonly meta: Record<string, unknown> = {}) {}

  /** Run a step; failures are recorded (and rethrown when `critical`). */
  async step<T>(name: string, fn: () => Promise<T | { detail?: string; links?: (string | null | undefined)[]; value?: T }>, opts: { critical?: boolean } = {}) {
    const t0 = Date.now();
    process.stdout.write(`• ${name} … `);
    try {
      const r = (await fn()) as { detail?: string; links?: (string | null | undefined)[]; value?: T } | undefined;
      const links = (r?.links ?? []).filter((l): l is string => !!l);
      this.steps.push({ name, ok: true, ms: Date.now() - t0, ...(r?.detail && { detail: r.detail }), ...(links.length && { links }) });
      console.log(`ok${r?.detail ? ` — ${r.detail}` : ""}`);
      for (const l of links) console.log(`    ${l}`);
      return r?.value as T;
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      this.steps.push({ name, ok: false, detail, ms: Date.now() - t0 });
      console.log(`FAILED — ${detail}`);
      if (opts.critical) throw e;
      return undefined;
    }
  }

  get ok() {
    return this.steps.every((s) => s.ok);
  }

  save(): string {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "reports");
    mkdirSync(dir, { recursive: true });
    const stamp = this.started.toISOString().replace(/[:.]/g, "-");
    const base = join(dir, `${this.network}-${stamp}`);
    const passed = this.steps.filter((s) => s.ok).length;
    const json = { network: this.network, startedAt: this.started.toISOString(), ok: this.ok, passed, total: this.steps.length, meta: this.meta, steps: this.steps };
    writeFileSync(`${base}.json`, `${JSON.stringify(json, null, 2)}\n`);
    const md = [
      `# codkit e2e — ${this.network}`,
      "",
      `${this.started.toISOString()} · **${this.ok ? "PASS" : "FAIL"}** (${passed}/${this.steps.length})`,
      "",
      ...Object.entries(this.meta).map(([k, v]) => `- ${k}: \`${String(v)}\``),
      "",
      "| Step | Result | Detail |",
      "| --- | --- | --- |",
      ...this.steps.map((s) => `| ${s.name} | ${s.ok ? "✅" : "❌"} | ${(s.detail ?? "").replace(/\|/g, "\\|")}${s.links?.length ? ` ${s.links.map((l, i) => `[link${s.links!.length > 1 ? i + 1 : ""}](${l})`).join(" ")}` : ""} |`),
      "",
    ].join("\n");
    writeFileSync(`${base}.md`, md);
    return `${base}.md`;
  }
}

export const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
export const flag = (name: string) => process.argv.includes(`--${name}`);
