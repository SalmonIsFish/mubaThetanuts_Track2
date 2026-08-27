/**
 * Deep bigint -> string serializer. Order.expiry/numContracts/price/strikes
 * and previewFillOrder's return are all real bigints (verified against the
 * installed SDK's dist/index.d.ts) -- JSON.stringify throws on those by
 * default, so every HTTP response must go through this first.
 */
export function jsonSafe<T>(value: T): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((v) => jsonSafe(v));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = jsonSafe(val);
    }
    return out;
  }
  return value;
}
