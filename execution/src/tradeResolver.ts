/**
 * Shared order-matching logic between the CLI script (executeMicroTrade.ts)
 * and the HTTP API (api/server.ts). Fixes the field-path bugs that used to
 * live inline in executeMicroTrade.ts -- see docs/ARCHITECTURE.md and the
 * approved plan for the verification trail against the real installed SDK
 * types (execution/node_modules/@thetanuts-finance/thetanuts-client/dist/index.d.ts).
 *
 * IMPORTANT, found by live-testing against the installed 0.3.0 client (not
 * documented anywhere): `client.api.filterOrders(...)` is broken -- it reads
 * `response.orders` but the Odette indexer's `/orders` endpoint actually
 * returns `{ data: { orders: [...] } }` (the same envelope `fetchOrders()`
 * already unwraps correctly), so any call to `filterOrders`, even with an
 * empty filter object, throws `Cannot read properties of undefined
 * (reading 'map')`. The indexer also appears to ignore the `asset`/`type`
 * query params entirely (verified by curling it directly -- filtered and
 * unfiltered responses were byte-identical). So: never call
 * `filterOrders()`. Instead, always call the verified-working
 * `fetchOrders()` and filter client-side here.
 *
 * Filtering by underlying asset also can't use `order.underlyingToken`
 * (the SDK's own `deriveUnderlyingFromPriceFeed` helper only has BTC/ETH in
 * its lookup table -- SOL orders resolve to the zero address). Instead this
 * matches each order's `rawApiData.priceFeed` address against
 * `client.chainConfig.priceFeeds`, which does have all three
 * (ETH/BTC/SOL) Chainlink feed addresses for Base mainnet.
 */
import type { OrderWithSignature, ThetanutsClient } from "@thetanuts-finance/thetanuts-client";
import type { GateTradeRequest } from "./gateClient.js";

export type SupportedAsset = "BTC" | "ETH" | "SOL";
export type OptionType = "put" | "call";

export const SUPPORTED_ASSETS: SupportedAsset[] = ["BTC", "ETH", "SOL"];

function buildPriceFeedToAssetMap(client: ThetanutsClient): Map<string, SupportedAsset> {
  const map = new Map<string, SupportedAsset>();
  for (const asset of SUPPORTED_ASSETS) {
    const address = client.chainConfig.priceFeeds[asset];
    if (address) map.set(address.toLowerCase(), asset);
  }
  return map;
}

/**
 * Live (unexpired), asset/type-filtered orders, filtered entirely
 * client-side against `fetchOrders()` output -- see the module-level note
 * on why `filterOrders()` cannot be used.
 */
export async function findLiveOrders(
  client: ThetanutsClient,
  { asset, optionType, vanillaOnly = false }: { asset?: SupportedAsset; optionType?: OptionType; vanillaOnly?: boolean },
): Promise<OrderWithSignature[]> {
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const orders = await client.api.fetchOrders();
  const feedMap = buildPriceFeedToAssetMap(client);

  return orders.filter((o) => {
    if (o.order.expiry <= nowSec) return false;
    if (vanillaOnly && (o.order.strikes?.length ?? 0) !== 1) return false;
    if (optionType) {
      const wantCall = optionType === "call";
      if (Boolean(o.rawApiData?.isCall) !== wantCall) return false;
    }
    if (asset) {
      const feed = o.rawApiData?.priceFeed?.toLowerCase();
      if (!feed || feedMap.get(feed) !== asset) return false;
    }
    return true;
  });
}

export interface ResolvedTrade {
  candidate: OrderWithSignature;
  preview: ReturnType<ThetanutsClient["optionBook"]["previewFillOrder"]>;
  spotPrice: number;
  spendUsdcBigint: bigint;
  delta: number | null;
}

export async function resolveTradeIntent(
  client: ThetanutsClient,
  { asset, optionType, spendUsdc }: { asset: SupportedAsset; optionType: OptionType; spendUsdc: number },
): Promise<ResolvedTrade> {
  const vanilla = await findLiveOrders(client, { asset, optionType, vanillaOnly: true });
  if (!vanilla.length) {
    throw new Error(`No active vanilla ${optionType.toUpperCase()} order found for ${asset}.`);
  }

  const marketData = await client.api.getMarketData();
  const spotPrice = marketData.prices[asset];
  if (spotPrice === undefined) {
    throw new Error(`No live spot price available for ${asset}.`);
  }

  // Default pick: nearest strike to spot (closest to at-the-money).
  const candidate = vanilla.reduce((best, o) => {
    const bestDist = Math.abs(Number(best.order.strikes![0]) / 1e8 - spotPrice);
    const dist = Math.abs(Number(o.order.strikes![0]) / 1e8 - spotPrice);
    return dist < bestDist ? o : best;
  });

  if (spendUsdc <= 0) {
    throw new Error("spendUsdc must be positive.");
  }
  const spendUsdcBigint = BigInt(Math.round(spendUsdc * 1_000_000));

  const preview = client.optionBook.previewFillOrder(candidate, spendUsdcBigint);
  const delta = candidate.rawApiData?.greeks?.delta ?? null;

  return { candidate, preview, spotPrice, spendUsdcBigint, delta };
}

/**
 * `previewFillOrder`'s `numContracts` is NOT the 18-decimal convention the
 * SDK's general docs describe for on-chain `Order.numContracts` -- verified
 * against the installed 0.3.0 client's source: this specific field is
 * `usdcAmount(6dp) * 1e8 / price(8dp)`, which is dimensionally contracts
 * scaled by 1e6 (matching USDC's own decimals), confirmed by the numbers
 * lining up exactly against a live preview during this session. Purely
 * informational -- `fillOrder` itself takes the raw USDC bigint, not this
 * field -- but worth converting correctly for anything human-facing.
 */
export function numContractsHuman(preview: ResolvedTrade["preview"]): number {
  return Number(preview.numContracts) / 1_000_000;
}

/**
 * Builds the gate-chain /evaluate request body. Structure is always
 * VANILLA_{PUT,CALL} and side is always BUY -- this pass only implements
 * the OptionBook taker-fill (fully-paid long) path, matching the existing
 * executeMicroTrade.ts scope. Posted and required collateral are both the
 * previewed spend since the taker pays the previewed amount in full, no
 * partial fill for this demo.
 */
export function buildGateRequest({
  asset,
  optionType,
  spendUsdc,
  resolved,
}: {
  asset: SupportedAsset;
  optionType: OptionType;
  spendUsdc: number;
  resolved: ResolvedTrade;
}): GateTradeRequest {
  return {
    underlying_symbol: asset,
    option_type: optionType.toUpperCase() as "PUT" | "CALL",
    structure: `VANILLA_${optionType.toUpperCase()}`,
    side: "BUY",
    num_contracts: numContractsHuman(resolved.preview),
    strike: Number(resolved.candidate.order.strikes![0]) / 1e8,
    spot_price: resolved.spotPrice,
    notional_usd: spendUsdc,
    collateral_token: "USDC",
    posted_collateral_amount: spendUsdc,
    required_collateral_amount: spendUsdc,
    delta: resolved.delta,
  };
}
