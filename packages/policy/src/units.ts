/**
 * Decimal string -> atomic units, e.g. `toAtomic("1.5", 6) === 1_500_000n`.
 * Throws on more fractional digits than `decimals` rather than silently rounding.
 */
export function toAtomic(value: string | number, decimals: number): bigint {
  const s = typeof value === "number" ? value.toString() : value.trim();
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) throw new Error(`invalid decimal amount: ${value}`);
  const whole = m[1] ?? "0";
  const frac = m[2] ?? "";
  if (frac.length > decimals) throw new Error(`${value} has more than ${decimals} decimals`);
  return BigInt(whole + frac.padEnd(decimals, "0"));
}

/** Atomic units -> decimal string, e.g. `fromAtomic(1_500_000n, 6) === "1.5"`. */
export function fromAtomic(value: bigint, decimals: number): string {
  const neg = value < 0n;
  const s = (neg ? -value : value).toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** USDC (6 decimals) shorthand: `usdc("0.25") === 250_000n`. */
export const usdc = (value: string | number): bigint => toAtomic(value, 6);
