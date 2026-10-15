/** JSON value as stored in a receipt (after `normalize`). */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * Turn arbitrary app data into plain JSON so that what we hash is exactly what
 * we store: bigint → decimal string, Date → ISO string, bytes → 0x hex,
 * `undefined` object fields dropped. Rejects values that can't round-trip.
 */
export function normalize(value: unknown, path = "data"): Json {
  if (value === null) return null;
  switch (typeof value) {
    case "boolean":
    case "string":
      return value;
    case "number":
      if (!Number.isFinite(value)) throw new TypeError(`${path}: non-finite number`);
      return value;
    case "bigint":
      return value.toString();
    case "undefined":
      return null;
    case "object":
      break;
    default:
      throw new TypeError(`${path}: cannot store a ${typeof value}`);
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return `0x${Array.from(value, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  if (Array.isArray(value)) return value.map((v, i) => normalize(v, `${path}[${i}]`));
  if (value instanceof Map || value instanceof Set) throw new TypeError(`${path}: convert Map/Set to an object/array first`);
  if (value instanceof Error) return { name: value.name, message: value.message };
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined || typeof v === "function") continue;
    out[k] = normalize(v, `${path}.${k}`);
  }
  return out;
}

/** Deterministic serialisation (sorted keys, no whitespace) of normalised JSON — RFC 8785 style. */
export function canonicalize(value: Json): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k]!)}`).join(",")}}`;
}
