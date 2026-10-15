// End-to-end smoke test of the built dashboard (run `next build` first):
// start the server, run the demo agent, approve the approval request,
// and check that decisions, blocks, payments, receipts and the final answer arrive.
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const port = await new Promise((r) => {
  const s = createServer().listen(0, () => {
    const p = s.address().port;
    s.close(() => r(p));
  });
});
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", String(port)], {
  // blank every LLM key so the smoke test always runs the scripted demo agent
  env: { ...process.env, LLM_PROVIDER: "", GROQ_API_KEY: "", GEMINI_API_KEY: "", NVIDIA_API_KEY: "", OPENROUTER_API_KEY: "", AGENTROUTER_API_KEY: "", DEMO_STEP_MS: "0" },
  stdio: ["ignore", "ignore", "inherit"],
  detached: true, // own process group, so we can stop next and its workers together
});
const stop = () => {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {}
};
process.on("exit", stop);
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  stop();
  process.exit(1);
};
const timer = setTimeout(() => fail("timed out"), 90_000);

try {
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${base}/api/state`)).ok) break;
    } catch {}
    if (i > 150) fail("server did not start");
    await new Promise((r) => setTimeout(r, 200));
  }
  const html = await (await fetch(base)).text();
  if (!html.includes("Agent Console")) fail("page did not render");

  const feed = await fetch(`${base}/api/feed`);
  const run = await fetch(`${base}/api/run`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  if (run.status !== 202) fail(`run returned ${run.status}`);

  const seen = [];
  const reader = feed.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  outer: for (;;) {
    const { value, done } = await reader.read();
    if (done) fail("feed closed early");
    buf += value;
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const e = JSON.parse(line.slice(6));
      seen.push(e);
      if (e.kind === "approval_request") {
        const r = await fetch(`${base}/api/approve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ requestId: e.requestId, approved: true, by: "smoke-test" }),
        });
        if (!r.ok) fail("approve failed");
      }
      if (e.kind === "status" && (e.state === "done" || e.state === "error")) break outer;
    }
  }
  await reader.cancel();

  const status = seen.at(-1);
  if (status.state !== "done") fail(`run ended with ${status.state}: ${status.detail}`);
  const count = (pred) => seen.filter(pred).length;
  const checks = {
    "allowed payments": count((e) => e.kind === "policy" && e.verdict === "allow") >= 2,
    "approval requested + granted": count((e) => e.kind === "approval" && e.approved) === 1,
    "over-cap payment blocked": count((e) => e.kind === "policy" && e.verdict === "deny") >= 2,
    "settled txs (eth, sol, summary)": count((e) => e.kind === "tx") === 3,
    "tool errors surfaced": count((e) => e.kind === "tool_result" && !e.ok) === 1,
    receipts: count((e) => e.kind === "receipt") >= 8,
    "final answer": count((e) => e.kind === "message") === 1,
  };
  const state = await (await fetch(`${base}/api/state`)).json();
  checks["state: 3 payments, 0.27 USDC spent, receipts verify"] = state.payments === 3 && state.budget.spent === "0.27" && state.receipts.ok;

  const kill = await (await fetch(`${base}/api/kill`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
  checks["kill switch"] = kill.killed === true && (await (await fetch(`${base}/api/state`)).json()).killed === true;

  const failed = Object.entries(checks).filter(([, ok]) => !ok);
  if (process.env.SMOKE_DEBUG) for (const e of seen.filter((e) => e.kind === "tool_result" && !e.ok)) console.log("tool error:", e.output);
  for (const [name, ok] of Object.entries(checks)) console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (failed.length) fail(`${failed.length} check(s) failed`);
  console.log(`✓ smoke test passed (${seen.length} feed events)`);
} finally {
  clearTimeout(timer);
  stop();
}
