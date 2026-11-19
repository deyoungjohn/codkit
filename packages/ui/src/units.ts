/** Decimal string ↔ atomic bigint, exact (no floats). */
export function parseAmount(text: string, decimals: number): bigint | undefined {
  const t = text.trim();
  const m = /^(\d*)(?:\.(\d*))?$/.exec(t);
  if (!t || !m || (!m[1] && !m[2])) return undefined;
  const frac = m[2] ?? "";
  if (frac.length > decimals) return undefined;
  return BigInt((m[1] || "0") + frac.padEnd(decimals, "0"));
}

export function formatAmount(atomic: bigint, decimals: number, maxFraction = decimals): string {
  const neg = atomic < 0n;
  const s = (neg ? -atomic : atomic).toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals, s.length - decimals + maxFraction).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** `0x1234…abcd` / `7xKX…sAsU`. */
export function shortAddress(address: string, chars = 4): string {
  const head = address.startsWith("0x") ? chars + 2 : chars;
  return address.length <= head + chars + 1 ? address : `${address.slice(0, head)}…${address.slice(-chars)}`;
}
