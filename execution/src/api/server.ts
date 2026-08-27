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
import { ThetanutsClient } from "@thetanuts-finance/thetanuts-client";
import { evaluateTrade, requireReadyForExecution } from "../gateClient.js";
import {
  resolveTradeIntent,
  buildGateRequest,
  findLiveOrders,
  numContractsHuman,
  SUPPORTED_ASSETS,
  type SupportedAsset,
  type OptionType,
} from "../tradeResolver.js";
import { jsonSafe } from "../jsonSafe.js";

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

app.listen(API_PORT, () => {
  console.log(`Thetanuts execution API listening on http://127.0.0.1:${API_PORT}`);
  console.log(`Gate service: ${GATE_SERVICE_URL} | RPC: ${RPC_URL}`);
  console.log(`Signer configured: ${Boolean(process.env.THETANUTS_PRIVATE_KEY)}`);
});
