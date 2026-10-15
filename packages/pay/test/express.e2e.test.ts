import { usdc } from "@codkit/policy";
import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createBudgetedFetch } from "../src/index.js";
import { paywall } from "../src/server/express.js";
import { agent, fakeFacilitator, PAY_TO, USDC } from "./helpers.js";

const facilitator = fakeFacilitator();
const app = express();
app.use(paywall({ payTo: PAY_TO, facilitator, routes: { "GET /joke": "$0.001" } }));
app.get("/joke", (_req, res) => {
  res.json({ joke: "why did the agent cross the chain?" });
});

let base = "";
let server: ReturnType<typeof app.listen>;
beforeAll(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
});

it("serves a paid route over real HTTP", async () => {
  expect((await fetch(`${base}/joke`)).status).toBe(402);

  const { engine, client } = agent({ limits: [{ asset: USDC, perTx: usdc("0.01") }] });
  const res = await createBudgetedFetch({ engine, client })(`${base}/joke`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ joke: "why did the agent cross the chain?" });
  expect(facilitator.settle).toHaveBeenCalledOnce();
  expect(await engine.spendStore.list()).toEqual([expect.objectContaining({ status: "committed", amount: 1000n })]);
});
