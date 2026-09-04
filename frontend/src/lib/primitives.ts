interface Greeks {
  delta?: number;
  iv?: number;
}

/** Safe accessor for the optional greeks object on an order's rawApiData. */
export function assertGrecks(rawApiData: Record<string, unknown> | undefined): Greeks | null {
  if (!rawApiData) return null;
  const g = rawApiData.greeks as Greeks | undefined;
  if (!g) return null;
  return g;
}
