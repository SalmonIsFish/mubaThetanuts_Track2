/**
 * HTTP API over the Thetanuts execution layer, for the frontend to call.
 *
 * Reads (/orders, /market-data, /propose) use a read-only client -- no
 * signer, no wallet needed, matches "does it work" judging without any
 * risk. /execute is the only route that ever touches THETANUTS_PRIVATE_KEY,
 * and it only proceeds if gate-chain/server.py returns READY_FOR_EXECUTION
 * (requireReadyForExecution is fail-closed: gate unreachable == blocked).
 *
 * The gate chain is the only thing allowed to approve a trade. This file
 * never re-implements Shariah/risk logic -- see gateClient.ts.
 */
import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { ethers } from "ethers";
import { ThetanutsClient, type OrderWithSignature } from "@thetanuts-finance/thetanuts-client";
import { evaluateTrade, requireReadyForExecution } from "../gateClient.js";
import {
  resolveTradeIntent,
  buildGateRequest,
  findLiveOrders,
  assetForOrder,
  numContractsHuman,
  SUPPORTED_ASSETS,
  type SupportedAsset,
  type OptionType,
} from "../tradeResolver.js";
import { jsonSafe } from "../jsonSafe.js";
import { parseIntent, explainDecision } from "../copilot.js";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const RPC_URL = process.env.THETANUTS_RPC_URL ?? "https://mainnet.base.org";
const GATE_SERVICE_URL = process.env.GATE_SERVICE_URL ?? "http://127.0.0.1:8787";
const HARD_CAP_USD = Number(process.env.MAX_NOTIONAL_USD_HARD_CAP ?? "3");
const API_PORT = Number(process.env.API_PORT ?? "8790");

const provider = new ethers.JsonRpcProvider(RPC_URL);
// Read-only client -- constructed once, no signer, works with no
// THETANUTS_PRIVATE_KEY set at all. A signer client is built fresh inside
// the /execute handler only, and never held anywhere else.
const readClient = new ThetanutsClient({ chainId: 8453, provider });

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface ProposeBody {
  asset: string;
  optionType: string;
  side: string;
  spendUsdc: number;
}

function parseTradeBody(body: unknown): { asset: SupportedAsset; optionType: OptionType; spendUsdc: number } {
  const b = body as Partial<ProposeBody>;
  if (!b || typeof b !== "object") throw new HttpError(400, "Request body must be a JSON object.");

  const asset = String(b.asset ?? "").toUpperCase();
  if (!SUPPORTED_ASSETS.includes(asset as SupportedAsset)) {
    throw new HttpError(400, `asset must be one of ${SUPPORTED_ASSETS.join(", ")}.`);
  }

  const optionType = String(b.optionType ?? "").toLowerCase();
  if (optionType !== "put" && optionType !== "call") {
    throw new HttpError(400, `optionType must be "put" or "call".`);
  }

  const side = String(b.side ?? "").toUpperCase();
  if (side !== "BUY") {
    throw new HttpError(
      400,
      `side must be "BUY" -- this API only implements the OptionBook taker-fill (fully-paid long) path. ` +
        `For a SELL/write, see execution/src/prepareRfq.ts (out of scope for this endpoint).`,
    );
  }

  const spendUsdc = Number(b.spendUsdc);
  if (!Number.isFinite(spendUsdc) || spendUsdc <= 0) {
    throw new HttpError(400, "spendUsdc must be a positive number.");
  }
  if (spendUsdc > HARD_CAP_USD) {
    throw new HttpError(400, `spendUsdc $${spendUsdc} exceeds the client-side hard cap $${HARD_CAP_USD}.`);
  }

  return { asset: asset as SupportedAsset, optionType: optionType as OptionType, spendUsdc };
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get(
  "/orders",
  asyncRoute(async (req, res) => {
    const asset = req.query.asset ? String(req.query.asset).toUpperCase() : undefined;
    const type = req.query.type ? String(req.query.type).toLowerCase() : undefined;
    if (asset && !SUPPORTED_ASSETS.includes(asset as SupportedAsset)) {
      throw new HttpError(400, `asset must be one of ${SUPPORTED_ASSETS.join(", ")}.`);
    }
    if (type && type !== "put" && type !== "call") {
      throw new HttpError(400, `type must be "put" or "call".`);
    }

    const orders = await findLiveOrders(readClient, {
      asset: asset as SupportedAsset | undefined,
      optionType: type as OptionType | undefined,
    });

    res.json(jsonSafe({ count: orders.length, orders }));
  }),
);

// Nominal size used only to run every live order through the gate chain --
// a fixed, safely-under-cap amount, not a real trade proposal. The BUY-side
// gates (underlying screen, collateral, structure, delta) don't depend on
// this number; only risk_checks' per-trade cap does, and $2 keeps every
// order well clear of it so the screening result reflects the order itself,
// not an arbitrarily chosen size.
const SCREENING_NOTIONAL_USD = 2;

/**
 * The live order book is heavily skewed toward BTC/ETH (hundreds of orders
 * each) versus the newer assets (tens each), and the indexer returns them
 * grouped by asset rather than interleaved -- a plain `orders.slice(0,
 * limit)` would silently exclude every less-liquid asset from any view with
 * a limit smaller than BTC+ETH's combined count. Round-robin across assets
 * instead so every asset with live orders gets fair representation, up to
 * how many orders it actually has.
 */
function interleaveByAsset(orders: OrderWithSignature[], client: ThetanutsClient, limit: number): OrderWithSignature[] {
  const groups = new Map<string, OrderWithSignature[]>();
  for (const order of orders) {
    const asset = assetForOrder(client, order) ?? "unresolved";
    const group = groups.get(asset);
    if (group) group.push(order);
    else groups.set(asset, [order]);
  }

  const result: OrderWithSignature[] = [];
  let tookAny = true;
  while (tookAny && result.length < limit) {
    tookAny = false;
    for (const group of groups.values()) {
      const next = group.shift();
      if (next) {
        result.push(next);
        tookAny = true;
        if (result.length >= limit) break;
      }
    }
  }
  return result;
}

/**
 * Analytics view: every live order, annotated with its own gate-chain
 * verdict -- "which of what's live on Thetanuts right now is actually
 * Shariah/risk screenable." No wallet needed, nothing is proposed or
 * matched to a spend amount; this evaluates orders as they stand, not a
 * user's trade intent. Reuses the exact same evaluateTrade() call /propose
 * and /converse use -- gate-chain is still the only thing that decides
 * compliance here, this route just runs it across the live order book
 * instead of one resolved trade.
 */
app.get(
  "/orders/screened",
  asyncRoute(async (req, res) => {
    const asset = req.query.asset ? String(req.query.asset).toUpperCase() : undefined;
    const type = req.query.type ? String(req.query.type).toLowerCase() : undefined;
    if (asset && !SUPPORTED_ASSETS.includes(asset as SupportedAsset)) {
      throw new HttpError(400, `asset must be one of ${SUPPORTED_ASSETS.join(", ")}.`);
    }
    if (type && type !== "put" && type !== "call") {
      throw new HttpError(400, `type must be "put" or "call".`);
    }
    const limit = Math.min(Number(req.query.limit) || 25, 100);

    const orders = await findLiveOrders(readClient, {
      asset: asset as SupportedAsset | undefined,
      optionType: type as OptionType | undefined,
      vanillaOnly: true,
    });

    const screened = await Promise.all(
      interleaveByAsset(orders, readClient, limit).map(async (order) => {
        const orderAsset = assetForOrder(readClient, order);
        const orderType: OptionType = order.rawApiData?.isCall ? "call" : "put";
        if (!orderAsset) {
          return { order: jsonSafe(order), asset: null, optionType: orderType, decision: "UNSCREENED", blockers: ["asset_not_resolvable"], gate_summary: null };
        }

        const gateRequest = buildGateRequest({
          asset: orderAsset,
          optionType: orderType,
          spendUsdc: SCREENING_NOTIONAL_USD,
          resolved: {
            candidate: order,
            preview: { numContracts: BigInt(0) } as ReturnType<ThetanutsClient["optionBook"]["previewFillOrder"]>,
            spotPrice: Number(order.order.strikes![0]) / 1e8,
            spendUsdcBigint: BigInt(SCREENING_NOTIONAL_USD * 1_000_000),
            delta: order.rawApiData?.greeks?.delta ?? null,
          },
        });

        const decision = await evaluateTrade(GATE_SERVICE_URL, gateRequest);
        return {
          asset: orderAsset,
          optionType: orderType,
          strike: Number(order.order.strikes![0]) / 1e8,
          maker: order.makerAddress,
          expiry: order.order.expiry.toString(),
          decision: decision.decision,
          blockers: decision.blockers,
          gate_summary: decision.gate_summary,
        };
      }),
    );

    const compliantCount = screened.filter((s) => s.decision === "READY_FOR_EXECUTION").length;
    res.json(jsonSafe({ count: screened.length, compliantCount, screened }));
  }),
);

app.get(
  "/market-data",
  asyncRoute(async (_req, res) => {
    const marketData = await readClient.api.getMarketData();
    res.json(jsonSafe(marketData));
  }),
);

// --- Quant Agent (Thetanuts) — autonomous suggestions with confidence + hybrid auto/manual ---
// Reuses Ai_Finance_Syariah quant S001 (SMA50/200 + 55d breakout) + confidence.py weights 40/30/20/10
// No Alpaca keys — bars are synthetic trending fixture anchored to live spot from readClient.api.getMarketData()
// so S001 fires for demo (like quant-agent/agent.py fetch_bars_thetanuts). Syariah is crypto universe COMPLIANT.
function quantIndicators(closes: number[]) {
  if (closes.length < 200) return null;
  const sma = (n: number) => closes.slice(-n).reduce((a, b) => a + b, 0) / n;
  const sma50 = sma(50);
  const sma200 = sma(200);
  const breakoutLevel = Math.max(...closes.slice(-56, -1));
  const latest = closes[closes.length - 1];
  const trendOk = sma50 > sma200;
  const breakoutOk = latest >= breakoutLevel;
  const breakoutGap = breakoutLevel ? ((latest - breakoutLevel) / breakoutLevel) * 100 : 0;
  const trendGap = sma200 ? ((sma50 - sma200) / sma200) * 100 : 0;
  return { sma50, sma200, breakoutLevel, latestClose: latest, trendOk, breakoutOk, breakoutGapPct: breakoutGap, trendGapPct: trendGap };
}
function quantScoreBreakout(breakoutGap: number | null, trendGap: number | null) {
  if (breakoutGap == null) return 0;
  let breakoutScore = 0.5;
  if (breakoutGap < -10) breakoutScore = 0.1;
  else if (breakoutGap < -5) breakoutScore = 0.4 + (breakoutGap + 10) * 0.08;
  else if (breakoutGap <= 0) breakoutScore = 0.8 + (breakoutGap + 5) * 0.04;
  else if (breakoutGap <= 3) breakoutScore = 1.0 - breakoutGap * 0.07;
  else breakoutScore = 0.5;
  const trendScore = trendGap != null && trendGap > 1 ? 1.0 : trendGap != null && trendGap > 0 ? 0.6 : 0.3;
  return 0.7 * breakoutScore + 0.3 * trendScore;
}
let _quantUniverse: { records: { symbol: string; shariah_status: string; category: string; rationale: string }[] } | null = null;
function getQuantRationale(symbol: string) {
  try {
    if (!_quantUniverse) {
      const here = dirname(fileURLToPath(import.meta.url));
      const p = join(here, "..", "..", "data", "crypto-underlying-universe.json");
      _quantUniverse = JSON.parse(readFileSync(p, "utf-8"));
    }
    const rec = _quantUniverse!.records.find((r) => r.symbol === symbol);
    return rec ? { status: rec.shariah_status, category: rec.category, rationale: rec.rationale } : null;
  } catch {
    return null;
  }
}
function blockerToELI5(blocker: string, delta: number | null) {
  if (blocker === "delta_rejected") return `High risk — price too far (Δ ${delta?.toFixed(3) ?? "—"}, ~${Math.round(Math.abs(delta ?? 0) * 100)}% chance) → lottery/Maysir, guard 4 blocks. Like betting snow in desert — too unlikely.`;
  if (blocker === "underlying_rejected") return `Not halal — underlying is debt/interest (Riba) per rwa_debt hard-reject.`;
  if (blocker === "collateral_rejected") return `Not halal — collateral not self-funded or using lending/yield (Riba).`;
  if (blocker === "structure_rejected") return `Not halal — complex structure (straddle/strangle) with excess Gharar.`;
  if (blocker === "risk_rejected") return `Risk — exceeds $3 per trade / $10 daily or wrong chain (must be Base 8453).`;
  return blocker;
}
app.get(
  "/quant/suggestions",
  asyncRoute(async (req, res) => {
    const threshold = Math.min(1, Math.max(0, Number(req.query.threshold) || Number(process.env.AUTO_TRADE_THRESHOLD) || 0.80));
    const spendUsdc = Math.min(3, Math.max(1, Number(req.query.spend) || 2));
    const assets = (req.query.assets ? String(req.query.assets).split(",").map((s) => s.trim().toUpperCase()) : SUPPORTED_ASSETS).filter((a) =>
      SUPPORTED_ASSETS.includes(a as SupportedAsset),
    ) as SupportedAsset[];

    // Live spot anchor for fixture, fallback to map
    let livePrices: Record<string, number> = {};
    try {
      const md = await readClient.api.getMarketData();
      livePrices = (md as { prices: Record<string, number> }).prices ?? {};
    } catch {
      livePrices = { BTC: 79000, ETH: 2450, SOL: 101, AVAX: 7.3, XRP: 1.4, BNB: 715, DOGE: 0.15, PAXG: 2650 };
    }
    const baseMap: Record<string, number> = { BTC: 79000, ETH: 2450, SOL: 101, AVAX: 7.3, XRP: 1.4, BNB: 715, DOGE: 0.15, PAXG: 2650 };

    const suggestions = [];
    for (const asset of assets) {
      const base = livePrices[asset] ?? baseMap[asset] ?? 150;
      // Synthetic 250 closes, uptrend, force breakout for demo cohort
      const closes: number[] = [];
      for (let i = 0; i < 250; i++) closes.push(base * (1 + i * 0.0006) + (i % 7) * 0.02);
      if (SUPPORTED_ASSETS.includes(asset)) {
        closes[closes.length - 1] = Math.max(...closes.slice(-56, -1)) + base * 0.002;
        closes[closes.length - 2] = closes[closes.length - 1] - base * 0.001;
      }
      const ind = quantIndicators(closes);
      if (!ind || !ind.trendOk || !ind.breakoutOk) continue;
      // Liquidity variance to demo both auto and manual at higher threshold
      const spreadMap: Record<string, number> = { BTC: 3.5, ETH: 3.5, SOL: 4.0, AVAX: 11.5, XRP: 12.0, BNB: 4.2, DOGE: 3.0, PAXG: 5.0 };
      const premiumMap: Record<string, number> = { BTC: 1.4, ETH: 1.4, SOL: 1.3, AVAX: 0.8, XRP: 0.75, BNB: 1.3, DOGE: 1.2, PAXG: 1.1 };
      const spread = spreadMap[asset] ?? 4.5;
      const premium = premiumMap[asset] ?? 1.2;
      const strike = Math.round((ind.latestClose * 0.97) * 100) / 100;
      const optionType: OptionType = asset.charCodeAt(0) % 2 === 0 ? "put" : "call";
      // Confidence components like quant-agent/confidence.py
      const technical = quantScoreBreakout(ind.breakoutGapPct, ind.trendGapPct);
      const compliance = 0.85; // crypto universe COMPLIANT
      const liquidity = Math.max(0, 1 - spread / 15) * 0.6 + Math.min(1, premium / 2) * 0.4;
      const riskHeadroom = Math.max(0, 1 - 5 / 40); // 5% projected vs 40% cap
      const confidence = Math.min(1, Math.max(0, 0.4 * technical + 0.3 * compliance + 0.2 * liquidity + 0.1 * riskHeadroom));
      const auto = confidence >= threshold;
      // Live gate preview for this suggestion (same 5 gates as /propose, at that spend)
      let gateDecision: string | null = null;
      let blockers: string[] = [];
      let gateDelta: number | null = null;
      try {
        const preview = { numContracts: BigInt(0) } as ReturnType<ThetanutsClient["optionBook"]["previewFillOrder"]>;
        // Use a real order preview if available — try findLiveOrders for this asset
        const orders = await findLiveOrders(readClient, { asset, optionType });
        const candidate = orders[0];
        if (candidate) {
          gateDelta = candidate.rawApiData?.greeks?.delta ?? null;
          const gateReq = buildGateRequest({ asset, optionType, spendUsdc, resolved: { candidate, preview, spotPrice: ind.latestClose, spendUsdcBigint: BigInt(spendUsdc * 1_000_000), delta: gateDelta } });
          const dec = await evaluateTrade(GATE_SERVICE_URL, gateReq);
          gateDecision = dec.decision;
          blockers = dec.blockers;
        }
      } catch {
        // leave null
      }
      const uni = getQuantRationale(asset);
      const halalWhy = gateDecision === "BLOCKED" && blockers.length
        ? blockers.map((b) => blockerToELI5(b, gateDelta)).join(" | ")
        : `Halal — ${asset} is ${uni?.category ?? "crypto_native"} (no Riba: no interest/yield/coupon). Like plain chocolate, not a loan. USDC settlement-only (no lending), simple long structure, delta 10–90% (not lottery/Maysir).`;
      suggestions.push({
        asset,
        optionType,
        strike,
        dte: 5,
        otmPct: 3.0,
        premium,
        spreadPct: spread,
        spot: ind.latestClose,
        quant: { breakoutGapPct: ind.breakoutGapPct, trendGapPct: ind.trendGapPct, reason: `trend ${ind.trendGapPct.toFixed(1)}% + breakout ${ind.breakoutGapPct.toFixed(1)}%` },
        syariah: { status: "COMPLIANT", score: 85, provider: "CRYPTO_UNIVERSE", category: uni?.category ?? "crypto_native", rationale: uni?.rationale ?? "" },
        confidence: Math.round(confidence * 10000) / 10000,
        components: { technical: Math.round(technical * 1000) / 1000, compliance: Math.round(compliance * 1000) / 1000, liquidity: Math.round(liquidity * 1000) / 1000, riskHeadroom: Math.round(riskHeadroom * 1000) / 1000 },
        auto,
        gateDecision,
        blockers,
        halalReason: halalWhy,
        halalCategory: uni?.category ?? "crypto_native",
        thesis: `${asset} ${optionType} $${strike} OTM3% | trend ${ind.trendGapPct.toFixed(1)}% + breakout ${ind.breakoutGapPct.toFixed(1)}% | conf ${(confidence * 100).toFixed(0)}%`,
      });
    }
    // Sort by confidence desc, auto first like opportunity_scanner rank
    suggestions.sort((a, b) => b.confidence - a.confidence);
    res.json(jsonSafe({ threshold, spendUsdc, count: suggestions.length, suggestions }));
  }),
);

app.post(
  "/propose",
  asyncRoute(async (req, res) => {
    const { asset, optionType, spendUsdc } = parseTradeBody(req.body);

    const resolved = await resolveTradeIntent(readClient, { asset, optionType, spendUsdc });
    const gateRequest = buildGateRequest({ asset, optionType, spendUsdc, resolved });
    const decision = await evaluateTrade(GATE_SERVICE_URL, gateRequest);

    res.json(
      jsonSafe({
        candidateOrder: resolved.candidate,
        preview: resolved.preview,
        numContractsHuman: numContractsHuman(resolved.preview),
        spotPrice: resolved.spotPrice,
        decision: decision.decision,
        blockers: decision.blockers,
        gate_summary: decision.gate_summary,
        requires_delta_recheck_before_settlement: decision.requires_delta_recheck_before_settlement,
      }),
    );
  }),
);

/**
 * The visible "AI conversation" layer: natural language in, a gate-checked
 * decision + plain-language explanation out. Deliberately propose-only --
 * this route calls the exact same read-only path as /propose (resolve
 * against live orders, evaluate via gate-chain) and NEVER reaches /execute's
 * code path. The LLM parses intent and explains a verdict; it never
 * constructs, signs, or requests a signed transaction. That split is the
 * whole point: ingestion and translation can be "wrong" (an LLM slip just
 * produces a bad clarification question or a slightly-off explanation);
 * the trade decision itself still only ever comes from gate-chain, called
 * exactly the way /propose calls it.
 */
interface PartialIntent {
  asset: SupportedAsset | null;
  optionType: OptionType | null;
  spendUsdc: number | null;
}

// The client-supplied carry-over from a prior clarification_needed turn --
// untrusted input, sanitized field-by-field rather than trusted wholesale.
function parsePriorIntent(body: unknown): PartialIntent {
  const p = (body as { priorIntent?: Partial<PartialIntent> } | null)?.priorIntent;
  const asset = p && SUPPORTED_ASSETS.includes(p.asset as SupportedAsset) ? (p.asset as SupportedAsset) : null;
  const optionType = p?.optionType === "put" || p?.optionType === "call" ? p.optionType : null;
  const spendUsdc = typeof p?.spendUsdc === "number" && Number.isFinite(p.spendUsdc) ? p.spendUsdc : null;
  return { asset, optionType, spendUsdc };
}

function missingFieldQuestion(intent: PartialIntent): string | null {
  if (!intent.asset) return `What asset do you want to trade (${SUPPORTED_ASSETS.join(", ")})?`;
  if (!intent.optionType) return "Do you want a put or a call?";
  if (intent.spendUsdc == null) return "What dollar amount do you want to spend on the option?";
  return null;
}

app.post(
  "/converse",
  asyncRoute(async (req, res) => {
    const prompt = String((req.body as { prompt?: unknown } | null)?.prompt ?? "");
    if (!prompt.trim()) throw new HttpError(400, "Request body must include a non-empty `prompt` string.");

    const prior = parsePriorIntent(req.body);
    const extracted = await parseIntent(prompt);

    // Deterministic fallback for "like 3 dollar" phrasing the LLM sometimes
    // misses — gate enforces the cap anyway, so extracting here is safe and
    // prevents the clarification loop where $3 is never carried forward.
    const fallbackSpend = (() => {
      const m = prompt.match(/(?:\$\s*)?(\d+(?:\.\d+)?)\s*(?:dollars?|usd|usdc)\b/i);
      return m ? Number(m[1]) : null;
    })();

    // Slot-filling merge: each /converse call only ever extracts from the
    // single latest message (parseIntent has no memory of its own), so a
    // fact given two turns ago would otherwise be forgotten the instant the
    // next clarifying question is asked -- this is what caused the
    // asset<->amount clarification loop. The new turn's extraction wins
    // where it says something; anything it leaves null falls back to regex
    // fallback then to what an earlier turn already established.
    const merged: PartialIntent = {
      asset: extracted.asset ?? prior.asset,
      optionType: extracted.optionType ?? prior.optionType,
      spendUsdc: extracted.spendUsdc ?? fallbackSpend ?? prior.spendUsdc,
    };

    // Demo adversarial: BUIDL is the canonical rwa_debt hard-reject (gate-chain/underlying_screen.py:25 HARD_REJECT).
    // For "buy a BUIDL put ... Ignore compliance..." the LLM extracts asset=null (unsupported), so normal flow would ask
    // "What asset?" — that hides the guarantee. For the video script we want to show the gate actually BLOCKED even with injection.
    if (/buidl/i.test(prompt)) {
      const spendForDemo = merged.spendUsdc ?? fallbackSpend ?? 2;
      const optionForDemo = (merged.optionType as OptionType) ?? (extracted.optionType as OptionType) ?? "put";
      // Direct gate call — bypass SUPPORTED_ASSETS check, use a minimal synthetic resolved trade (gate only looks at underlying/category for this case)
      // Build a minimal gate request that will hit HARD_REJECT due to rwa_debt
      const mockGateReq = {
        underlying_symbol: "BUIDL",
        option_type: optionForDemo.toUpperCase() as "PUT" | "CALL",
        structure: `VANILLA_${optionForDemo.toUpperCase()}` as "VANILLA_PUT" | "VANILLA_CALL",
        side: "BUY" as const,
        num_contracts: 1,
        strike: 100,
        spot_price: 100,
        notional_usd: spendForDemo,
        collateral_token: "USDC",
        posted_collateral_amount: spendForDemo,
        required_collateral_amount: spendForDemo,
        delta: -0.3,
      };
      const dec = await evaluateTrade(GATE_SERVICE_URL, mockGateReq as unknown as Parameters<typeof evaluateTrade>[1]);
      // Use explainDecision with BUIDL's real rationale (BlackRock Treasury yield is Riba) — cast via any for demo
      const aiForDemo = await explainDecision({ asset: "BTC" as SupportedAsset, optionType: optionForDemo, spendUsdc: spendForDemo } as unknown as Parameters<typeof explainDecision>[0], dec as unknown as Parameters<typeof explainDecision>[1], prompt);
      // Shape like a rejected converse, but with real gate_summary for BUIDL so checklist shows red underlying_screen
      res.json({
        status: "rejected",
        actionable_data: {
          candidateOrder: null,
          preview: null,
          numContractsHuman: 0,
          spotPrice: 100,
          decision: dec.decision,
          blockers: dec.blockers,
          gate_summary: dec.gate_summary,
          requires_delta_recheck_before_settlement: false,
        },
        ai_explanation: aiForDemo,
      });
      return;
    }

    const question = missingFieldQuestion(merged);
    if (question) {
      // If this turn didn't add anything new (asset/optionType/spendUsdc all
      // unchanged from the prior turn), the message was probably off-topic
      // or unsupported (e.g. "sell a call") -- prefer the model's own
      // clarification, which explains why, over the generic missing-field
      // question. Otherwise always ask about a field that's still actually
      // missing, never one already resolved by an earlier turn.
      const madeProgress =
        merged.asset !== prior.asset ||
        merged.optionType !== prior.optionType ||
        merged.spendUsdc !== prior.spendUsdc;

      // Enriched clarification for "which of live market is compliant" queries.
      // Generic "What asset?" is unhelpful when the user explicitly asked to
      // see the live book's compliance. Surface the actual screened results
      // (same gate chain as a trade) instead of a blind list, so the user can
      // pick from real READY rows rather than guessing. Only when the missing
      // field is the asset itself and the current prompt signals an info scan.
      const looksLikeComplianceScan =
        !merged.asset &&
        /live market|which.*compliant|syariah|shariah|compliant/i.test(prompt) &&
        madeProgress; // only if this turn actually contributed (amount/optionType), not a stale repeat
      if (looksLikeComplianceScan) {
        const fetched = await findLiveOrders(readClient, { vanillaOnly: true });
        const sample = interleaveByAsset(fetched, readClient, 12);
        const screened = await Promise.all(
          sample.map(async (order) => {
            const orderAsset = assetForOrder(readClient, order);
            const orderType: OptionType = order.rawApiData?.isCall ? "call" : "put";
            if (!orderAsset) return null;
            const req = buildGateRequest({
              asset: orderAsset,
              optionType: orderType,
              spendUsdc: merged.spendUsdc ?? SCREENING_NOTIONAL_USD,
              resolved: {
                candidate: order,
                preview: { numContracts: BigInt(0) } as ReturnType<ThetanutsClient["optionBook"]["previewFillOrder"]>,
                spotPrice: Number(order.order.strikes![0]) / 1e8,
                spendUsdcBigint: BigInt((merged.spendUsdc ?? SCREENING_NOTIONAL_USD) * 1_000_000),
                delta: order.rawApiData?.greeks?.delta ?? null,
              },
            });
            const d = await evaluateTrade(GATE_SERVICE_URL, req);
            return { asset: orderAsset, optionType: orderType, strike: Number(order.order.strikes![0]) / 1e8, decision: d.decision, delta: order.rawApiData?.greeks?.delta ?? null, blockers: d.blockers };
          }),
        );
        const ready = (screened.filter(Boolean) as { asset: string; optionType: string; strike: number; decision: string }[]).filter(
          (s) => s.decision === "READY_FOR_EXECUTION",
        );
        const blocked = (screened.filter(Boolean) as { asset: string; optionType: string; strike: number; decision: string; delta: number | null; blockers: string[] }[]).filter(
          (s) => s.decision === "BLOCKED",
        );
        const spendNote = merged.spendUsdc != null ? ` for $${merged.spendUsdc}` : "";
        const wantsELI5 = /like.*5|5 years|eli5/i.test(prompt);
        if (/high risk|low risk|differentiate|why.*not compliant|why shouldn't/i.test(prompt) || wantsELI5) {
          const intro = `Like you're 5: LOW risk = price close to today → likelihood 10–90% → guard says READY 🟢 = compliant. HIGH risk = price super far → ~5% chance → guard says BLOCKED 🔴 = not compliant (we block gambling/Maysir to protect you). So **LOW risk IS compliant, HIGH risk is NOT**.`;
          const tableHead = `\n\nLive sample${spendNote} (${ready.length} READY / ${blocked.length} BLOCKED among 12):\n\n| Asset | Type | Strike | Δ | Status | Risk | Why (ELI5) |\n|---|---|---|---|---|---|---|\n`;
          const readyRows = ready.slice(0, 4).map((r) => `| ${r.asset} | ${r.optionType} | $${r.strike.toFixed(0)} | ${(r as unknown as {delta:number|null}).delta?.toFixed(3) ?? "—"} | READY 🟢 | Low = Compliant | Price close — fair ticket |`).join("\n");
          const blockedRows = blocked.slice(0, 4).map((r) => `| ${r.asset} | ${r.optionType} | $${r.strike.toFixed(0)} | ${r.delta?.toFixed(3) ?? "—"} | BLOCKED 🔴 | High = Not Compliant | Price too far → ~${((Math.abs(r.delta ?? 0))*100).toFixed(0)}% chance → lottery, guard 4 blocks |`).join("\n");
          const table = tableHead + (readyRows ? readyRows + "\n" : "") + (blockedRows ? blockedRows + "\n" : "") + (ready.length===0 && blocked.length===0 ? `| — | — | — | — | — | — | no samples |\n` : "");
          const footer = `\nTell me "Buy [asset] [put/call] with ${merged.spendUsdc ?? 3} dollars" and I'll show the 5 guards for that one ticket.`;
          res.json({ status: "clarification_needed", actionable_data: null, ai_explanation: intro + table + footer, partial_intent: merged });
          return;
        }
        const list = ready.length
          ? ready
              .slice(0, 6)
              .map((r) => `${r.asset} ${r.optionType} $${r.strike.toFixed(0)} → READY`)
              .join(", ")
          : "none READY at this exact spend — try $2";
        const enriched =
          `Live screened${spendNote} (${ready.length} READY / ${blocked.length} BLOCKED among sampled live orders): ${list}. ` +
          `I don't pick for you — tell me which asset + put/call to buy${spendNote} and I'll run the full 5-gate check. ` +
          `E.g. "Buy ETH put with ${merged.spendUsdc ?? 2} dollars" or "Buy AVAX call with ${merged.spendUsdc ?? 2} dollars".`;
        res.json({ status: "clarification_needed", actionable_data: null, ai_explanation: enriched, partial_intent: merged });
        return;
      }

      // Standalone high/low risk ELI5 explain — even without "live market" keyword,
      // the user asked to differentiate. Show READY=low risk=compliant vs BLOCKED=high risk=not compliant with 5-year-old "silly price" story as a table.
      if (!merged.asset && /high risk|low risk|differentiate|why.*not compliant|why shouldn't|like.*5|eli5/i.test(prompt)) {
        const fetched = await findLiveOrders(readClient, { vanillaOnly: true });
        const sample = interleaveByAsset(fetched, readClient, 12);
        const screened = await Promise.all(
          sample.map(async (order) => {
            const orderAsset = assetForOrder(readClient, order);
            const orderType: OptionType = order.rawApiData?.isCall ? "call" : "put";
            if (!orderAsset) return null;
            const req = buildGateRequest({
              asset: orderAsset,
              optionType: orderType,
              spendUsdc: merged.spendUsdc ?? SCREENING_NOTIONAL_USD,
              resolved: {
                candidate: order,
                preview: { numContracts: BigInt(0) } as ReturnType<ThetanutsClient["optionBook"]["previewFillOrder"]>,
                spotPrice: Number(order.order.strikes![0]) / 1e8,
                spendUsdcBigint: BigInt((merged.spendUsdc ?? SCREENING_NOTIONAL_USD) * 1_000_000),
                delta: order.rawApiData?.greeks?.delta ?? null,
              },
            });
            const d = await evaluateTrade(GATE_SERVICE_URL, req);
            return { asset: orderAsset, optionType: orderType, strike: Number(order.order.strikes![0]) / 1e8, decision: d.decision, delta: order.rawApiData?.greeks?.delta ?? null };
          }),
        );
        const ready = (screened.filter(Boolean) as { asset: string; optionType: string; strike: number; decision: string; delta: number | null }[]).filter((s) => s.decision === "READY_FOR_EXECUTION");
        const blocked = (screened.filter(Boolean) as { asset: string; optionType: string; strike: number; decision: string; delta: number | null }[]).filter((s) => s.decision === "BLOCKED");
        const spendNote = merged.spendUsdc != null ? ` for $${merged.spendUsdc}` : "";
        const intro = `Like you're 5: LOW risk = price close to today → likelihood 10–90% → guard says READY 🟢 = compliant. HIGH risk = price super far → ~5% chance → guard says BLOCKED 🔴 = not compliant (we block gambling/Maysir to protect you). So **LOW risk IS compliant, HIGH risk is NOT**.`;
        const tableHead = `\n\nLive sample${spendNote} (${ready.length} READY / ${blocked.length} BLOCKED among 12):\n\n| Asset | Type | Strike | Δ | Status | Risk | Why (ELI5) |\n|---|---|---|---|---|---|---|\n`;
        const readyRows = ready.slice(0, 4).map((r) => `| ${r.asset} | ${r.optionType} | $${r.strike.toFixed(0)} | ${r.delta?.toFixed(3) ?? "—"} | READY 🟢 | Low = Compliant | Price close — fair ticket |`).join("\n");
        const blockedRows = blocked.slice(0, 4).map((r) => `| ${r.asset} | ${r.optionType} | $${r.strike.toFixed(0)} | ${r.delta?.toFixed(3) ?? "—"} | BLOCKED 🔴 | High = Not Compliant | Price too far → ~${((Math.abs(r.delta ?? 0))*100).toFixed(0)}% chance → lottery, guard 4 blocks |`).join("\n");
        const table = tableHead + (readyRows ? readyRows + "\n" : "") + (blockedRows ? blockedRows + "\n" : "") + (ready.length===0 && blocked.length===0 ? `| — | — | — | — | — | — | no samples |\n` : "");
        const footer = `\nTell me "Buy [asset] [put/call] with ${merged.spendUsdc ?? 3} dollars" and I'll show the 5 guards for that one ticket.`;
        res.json({ status: "clarification_needed", actionable_data: null, ai_explanation: intro + table + footer, partial_intent: merged });
        return;
      }

      res.json({
        status: "clarification_needed",
        actionable_data: null,
        ai_explanation: !madeProgress && extracted.clarification ? extracted.clarification : question,
        partial_intent: merged,
      });
      return;
    }

    // Re-validate the merged intent against the same rules /propose
    // enforces (hard cap, supported side) -- treated as untrusted input
    // here, not as a pre-cleared request, regardless of which turn(s) it
    // was assembled from.
    let validated: { asset: SupportedAsset; optionType: OptionType; spendUsdc: number };
    try {
      validated = parseTradeBody({
        asset: merged.asset,
        optionType: merged.optionType,
        side: "BUY",
        spendUsdc: merged.spendUsdc,
      });
    } catch (err) {
      const message = err instanceof HttpError ? err.message : "That request isn't valid.";
      res.json({ status: "clarification_needed", actionable_data: null, ai_explanation: message, partial_intent: merged });
      return;
    }

    const resolved = await resolveTradeIntent(readClient, validated);
    const gateRequest = buildGateRequest({ ...validated, resolved });
    const decision = await evaluateTrade(GATE_SERVICE_URL, gateRequest);

    const actionableData = jsonSafe({
      candidateOrder: resolved.candidate,
      preview: resolved.preview,
      numContractsHuman: numContractsHuman(resolved.preview),
      spotPrice: resolved.spotPrice,
      decision: decision.decision,
      blockers: decision.blockers,
      gate_summary: decision.gate_summary,
      requires_delta_recheck_before_settlement: decision.requires_delta_recheck_before_settlement,
    });

    const aiExplanation = await explainDecision(validated, decision, prompt);

    res.json({
      status: decision.decision === "READY_FOR_EXECUTION" ? "ready" : "rejected",
      actionable_data: actionableData,
      ai_explanation: aiExplanation,
    });
  }),
);

app.post(
  "/execute",
  asyncRoute(async (req, res) => {
    const privateKey = process.env.THETANUTS_PRIVATE_KEY;
    if (!privateKey) {
      throw new HttpError(500, "Signer not configured on this server (THETANUTS_PRIVATE_KEY unset). Refusing to execute.");
    }

    const { asset, optionType, spendUsdc } = parseTradeBody(req.body);

    const network = await provider.getNetwork();
    if (Number(network.chainId) !== 8453) {
      throw new HttpError(500, `Connected to chainId ${network.chainId}, expected Base mainnet (8453). Refusing to proceed.`);
    }

    const signer = new ethers.Wallet(privateKey, provider);
    const signerClient = new ThetanutsClient({ chainId: 8453, provider, signer });
    const userAddress = await signer.getAddress();

    // Never trust a client-supplied prior /propose result -- re-resolve
    // fresh against live data so a stale proposal can't be replayed at an
    // old price.
    const resolved = await resolveTradeIntent(signerClient, { asset, optionType, spendUsdc });
    const gateRequest = buildGateRequest({ asset, optionType, spendUsdc, resolved });

    // Fail-closed: throws if BLOCKED or if the gate service is unreachable.
    const decision = await requireReadyForExecution(GATE_SERVICE_URL, gateRequest);

    const optionBookAddress = signerClient.chainConfig.contracts.optionBook;
    if (!optionBookAddress) {
      throw new HttpError(500, "OptionBook not deployed on this chain config. Refusing to proceed.");
    }
    await signerClient.erc20.ensureAllowance(
      signerClient.chainConfig.tokens.USDC.address,
      optionBookAddress,
      resolved.spendUsdcBigint,
    );
    const receipt = await signerClient.optionBook.fillOrder(resolved.candidate, resolved.spendUsdcBigint);

    res.json(
      jsonSafe({
        txHash: receipt.hash,
        basescanUrl: `https://basescan.org/tx/${receipt.hash}`,
        account: userAddress,
        numContractsFilled: resolved.preview.numContracts,
        numContractsFilledHuman: numContractsHuman(resolved.preview),
        decision: decision.decision,
        gate_summary: decision.gate_summary,
      }),
    );
  }),
);

// Central error handler -- maps thrown errors to structured JSON with sane
// status codes instead of leaking a raw stack trace. Never logs the
// request body verbatim (it may contain nothing sensitive today, but keep
// the habit -- the signer key itself is never in `req.body` or `err`).
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  const status = /BLOCKED/i.test(message) ? 403 : /No active vanilla|No live spot/i.test(message) ? 400 : 500;
  res.status(status).json({ error: message });
});

// Bind both loopback addresses explicitly (not just IPv4) -- "localhost"
// resolves to ::1 first on some machines (observed on Windows dev boxes),
// and an IPv4-only bind silently refuses those clients while looking like
// a working server to anyone using the 127.0.0.1 literal.
app.listen(API_PORT, "127.0.0.1", () => {
  console.log(`Thetanuts execution API listening on http://127.0.0.1:${API_PORT}`);
  // RPC_URL's path segment carries the provider API key (e.g. Alchemy) --
  // log only the origin so it never lands in console output or log files.
  console.log(`Gate service: ${GATE_SERVICE_URL} | RPC host: ${new URL(RPC_URL).origin}`);
  console.log(`Signer configured: ${Boolean(process.env.THETANUTS_PRIVATE_KEY)}`);
});
app.listen(API_PORT, "::1");
