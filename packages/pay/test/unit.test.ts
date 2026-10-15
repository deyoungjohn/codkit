import { describe, expect, it } from "vitest";
import { paymentToAction } from "../src/index.js";
import { createPaywall } from "../src/server/core.js";
import { fakeFacilitator, PAY_TO, USDC } from "./helpers.js";

describe("paymentToAction", () => {
  it("maps x402 requirements to a policy action", () => {
    const action = paymentToAction(
      { scheme: "exact", network: "eip155:84532", asset: USDC, amount: "2500", payTo: PAY_TO, maxTimeoutSeconds: 60, extra: {} },
      { url: "https://api.example/weather", description: "weather" },
    );
    expect(action).toEqual({
      chain: "eip155:84532",
      kind: "x402_payment",
      to: PAY_TO,
      method: "x402:exact",
      spends: [{ asset: USDC, amount: 2500n }],
      meta: { scheme: "exact", resource: "https://api.example/weather", description: "weather" },
    });
  });
});

describe("createPaywall", () => {
  it("expands shorthand route specs", () => {
    const other = "0x4444444444444444444444444444444444444444";
    const { routes } = createPaywall({
      payTo: PAY_TO,
      facilitator: fakeFacilitator(),
      routes: {
        "GET /a": "$0.01",
        "GET /b": { price: "$0.02", description: "b", payTo: other, network: "eip155:8453" },
        "GET /c": { accepts: { scheme: "exact", price: "$0.03", network: "eip155:84532", payTo: PAY_TO }, mimeType: "text/plain" },
      },
    });
    expect(routes["GET /a"]).toEqual({ accepts: { scheme: "exact", price: "$0.01", network: "eip155:84532", payTo: PAY_TO } });
    expect(routes["GET /b"]).toEqual({
      accepts: { scheme: "exact", price: "$0.02", network: "eip155:8453", payTo: other },
      description: "b",
    });
    expect(routes["GET /c"]).toMatchObject({ mimeType: "text/plain" });
  });
});
