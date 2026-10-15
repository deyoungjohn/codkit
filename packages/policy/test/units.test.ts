import { describe, expect, it } from "vitest";
import { fromAtomic, toAtomic, usdc } from "../src/index.js";

describe("units", () => {
  it("converts decimals to atomic units", () => {
    expect(toAtomic("1.5", 6)).toBe(1_500_000n);
    expect(toAtomic("0.000001", 6)).toBe(1n);
    expect(toAtomic(2, 18)).toBe(2n * 10n ** 18n);
    expect(usdc("0.25")).toBe(250_000n);
  });

  it("refuses to round or parse garbage", () => {
    expect(() => toAtomic("0.0000001", 6)).toThrow(/more than 6 decimals/);
    expect(() => toAtomic("-1", 6)).toThrow();
    expect(() => toAtomic("1e6", 6)).toThrow();
  });

  it("converts back", () => {
    expect(fromAtomic(1_500_000n, 6)).toBe("1.5");
    expect(fromAtomic(1n, 6)).toBe("0.000001");
    expect(fromAtomic(5_000_000n, 6)).toBe("5");
    expect(fromAtomic(0n, 6)).toBe("0");
  });
});
