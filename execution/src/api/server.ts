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

    // Slot-filling merge: each /converse call only ever extracts from the
    // single latest message (parseIntent has no memory of its own), so a
    // fact given two turns ago would otherwise be forgotten the instant the
    // next clarifying question is asked -- this is what caused the
    // asset<->amount clarification loop. The new turn's extraction wins
    // where it says something; anything it leaves null falls back to what
    // an earlier turn already established.
    const merged: PartialIntent = {
      asset: extracted.asset ?? prior.asset,
      optionType: extracted.optionType ?? prior.optionType,
      spendUsdc: extracted.spendUsdc ?? prior.spendUsdc,
    };

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

    const aiExplanation = await explainDecision(validated, decision);

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
