/**
 * Minimal live execution path: OptionBook fillOrder on Base mainnet.
 *
 * This is the fastest of the two routes documented in
 * docs/ARCHITECTURE.md#3-minimal-execution-path (OptionBook vs RFQ/Factory).
 * OptionBook fills an already-posted maker order instantly, which matters
 * for a hackathon demo -- RFQ needs ~60s for market makers to respond and
 * is not guaranteed to fill.
 *
 * Flow, matching the SDK's documented four-step core flow:
 *   fetchOrders() -> previewFillOrder() -> gate check -> ensureAllowance() -> fillOrder()
 *
 * The Thetanuts MCP server is NOT used inside this script -- MCP's prepare_*
 * tools intentionally never sign or hold keys (see docs/ARCHITECTURE.md#1),
 * and OptionBook fillOrder has no prepare_* MCP tool at all (only RFQ
 * write-paths are exposed through MCP; see prepareRfq.ts for that route).
 * This script IS the signer boundary: it is the one place in the whole
 * system that touches PRIVATE_KEY, and it does nothing except (a) ask the
 * gate chain, (b) call the SDK.
 */

import "dotenv/config";
import { ethers } from "ethers";
import { ThetanutsClient } from "@thetanuts-finance/thetanuts-client";
import { requireReadyForExecution } from "./gateClient.js";

const RPC_URL = process.env.THETANUTS_RPC_URL ?? "https://mainnet.base.org";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const GATE_SERVICE_URL = process.env.GATE_SERVICE_URL ?? "http://127.0.0.1:8787";
const HARD_CAP_USD = Number(process.env.MAX_NOTIONAL_USD_HARD_CAP ?? "25");

// Which underlying/side we're demoing -- override via CLI args for the real run.
const TARGET_ASSET = process.argv[2] ?? "ETH";
const TARGET_TYPE = (process.argv[3] ?? "put").toLowerCase(); // "put" | "call"
const SPEND_USDC = BigInt(process.argv[4] ?? "10_000000".replace("_", "")); // 10 USDC, 6dp

// NOTE: field paths like `o.metadata?.asset`, `candidate.order.strikes[0]`
// scaling, and `candidate.metadata?.delta` are inferred from the SDK's prose
// docs (docs.thetanuts.finance/sdk/optionbook/*), not from reading the
// published .d.ts directly. Before the live run: `npm install`, then check
// `node_modules/@thetanuts-finance/thetanuts-client`'s type definitions (or
// just `console.log(JSON.stringify(orders[0], null, 2))`) and correct any
// field name/decimal-scaling mismatch. Treat this file as a verified
// skeleton, not a black box to run unread.

async function main() {
  if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY not set -- refusing to run without a signer configured explicitly.");

  const spendUsd = Number(SPEND_USDC) / 1_000_000;
  if (spendUsd > HARD_CAP_USD) {
    throw new Error(`Requested spend $${spendUsd} exceeds client-side hard cap $${HARD_CAP_USD}.`);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== 8453) {
    throw new Error(`Connected to chainId ${network.chainId}, expected Base mainnet (8453). Refusing to proceed.`);
  }

  const client = new ThetanutsClient({ chainId: 8453, provider, signer });
  const userAddress = await signer.getAddress();

  // 1. Browse maker orders for the target asset/type.
  const orders = await client.api.fetchOrders();
  const nowSec = Math.floor(Date.now() / 1000);
  const candidate = orders.find(
    (o) =>
      o.order.expiry > BigInt(nowSec) &&
      o.metadata?.asset === TARGET_ASSET &&
      o.metadata?.type === TARGET_TYPE &&
      o.order.strikes.length === 1, // vanilla only for the micro-trade demo
  );
  if (!candidate) throw new Error(`No active vanilla ${TARGET_TYPE.toUpperCase()} order found for ${TARGET_ASSET}.`);

  // 2. Preview the fill -- no tx yet.
  const preview = client.optionBook.previewFillOrder(candidate, SPEND_USDC);
  const marketData = await client.api.getMarketData();
  const spotPrice = marketData.prices[TARGET_ASSET];

  // 3. Gate check -- fail closed, this call throws if BLOCKED or unreachable.
  const decision = await requireReadyForExecution(GATE_SERVICE_URL, {
    underlying_symbol: TARGET_ASSET,
    option_type: TARGET_TYPE.toUpperCase() as "PUT" | "CALL",
    structure: `VANILLA_${TARGET_TYPE.toUpperCase()}`,
    side: "BUY", // OptionBook taker on a listed order = fully-paid long
    num_contracts: Number(preview.numContracts),
    strike: Number(candidate.order.strikes[0]) / 1e8, // adjust to the order's actual strike decimals
    spot_price: spotPrice,
    notional_usd: spendUsd,
    collateral_token: "USDC",
    posted_collateral_amount: spendUsd,
    required_collateral_amount: spendUsd, // taker pays the previewed amount in full, no partial fill for this demo
    delta: candidate.metadata?.delta ?? null, // pre-computed Greeks from the indexer, per SDK docs
  });
  console.log("Gate chain decision:", decision.decision, decision.gate_summary);

  // 4. Approve collateral spend, then fill.
  await client.erc20.ensureAllowance(
    client.chainConfig.tokens.USDC.address,
    client.chainConfig.contracts.optionBook,
    SPEND_USDC,
  );

  const receipt = await client.optionBook.fillOrder(candidate, SPEND_USDC);
  console.log(`Live trade executed on Base mainnet: https://basescan.org/tx/${receipt.hash}`);
  console.log(`Account: ${userAddress}`);
}

main().catch((err) => {
  console.error("Execution aborted:", err.message ?? err);
  process.exit(1);
});
