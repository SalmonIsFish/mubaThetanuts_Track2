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
 * system that touches THETANUTS_PRIVATE_KEY, and it does nothing except
 * (a) ask the gate chain, (b) call the SDK.
 */

import "dotenv/config";
import { ethers } from "ethers";
import { ThetanutsClient } from "@thetanuts-finance/thetanuts-client";
import { requireReadyForExecution } from "./gateClient.js";
import { resolveTradeIntent, buildGateRequest, numContractsHuman, type SupportedAsset, type OptionType } from "./tradeResolver.js";

const RPC_URL = process.env.THETANUTS_RPC_URL ?? "https://mainnet.base.org";
const PRIVATE_KEY = process.env.THETANUTS_PRIVATE_KEY;
const GATE_SERVICE_URL = process.env.GATE_SERVICE_URL ?? "http://127.0.0.1:8787";
const HARD_CAP_USD = Number(process.env.MAX_NOTIONAL_USD_HARD_CAP ?? "3");

// Which underlying/side we're demoing -- override via CLI args for the real run.
// Default trade size is 2 USDC: "1-3 USDC covers you... a 1 USDC fill scores
// exactly the same as 100" per the Thetanuts workshop deck -- there's no
// upside to sizing the demo trade any bigger.
const TARGET_ASSET = (process.argv[2] ?? "ETH") as SupportedAsset;
const TARGET_TYPE = (process.argv[3] ?? "put").toLowerCase() as OptionType; // "put" | "call"
const SPEND_USDC_ARG = process.argv[4] ?? "2000000"; // 2 USDC, 6dp
const SPEND_USDC = BigInt(SPEND_USDC_ARG);

async function main() {
  if (!PRIVATE_KEY) throw new Error("THETANUTS_PRIVATE_KEY not set -- refusing to run without a signer configured explicitly.");

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

  // 1-2. Find the best matching live order and preview the fill -- no tx yet.
  const resolved = await resolveTradeIntent(client, {
    asset: TARGET_ASSET,
    optionType: TARGET_TYPE,
    spendUsdc: spendUsd,
  });
  const { candidate, preview } = resolved;

  // 3. Gate check -- fail closed, this call throws if BLOCKED or unreachable.
  const decision = await requireReadyForExecution(
    GATE_SERVICE_URL,
    buildGateRequest({ asset: TARGET_ASSET, optionType: TARGET_TYPE, spendUsdc: spendUsd, resolved }),
  );
  console.log("Gate chain decision:", decision.decision, decision.gate_summary);

  // 4. Approve collateral spend, then fill.
  const optionBookAddress = client.chainConfig.contracts.optionBook;
  if (!optionBookAddress) throw new Error("OptionBook not deployed on this chain config -- refusing to proceed.");
  await client.erc20.ensureAllowance(client.chainConfig.tokens.USDC.address, optionBookAddress, SPEND_USDC);

  const receipt = await client.optionBook.fillOrder(candidate, SPEND_USDC);
  console.log(`Live trade executed on Base mainnet: https://basescan.org/tx/${receipt.hash}`);
  console.log(`Account: ${userAddress}`);
  console.log(`Filled ${numContractsHuman(preview)} contracts at strike ${Number(candidate.order.strikes![0]) / 1e8}`);
}

main().catch((err) => {
  console.error("Execution aborted:", err.message ?? err);
  process.exit(1);
});
