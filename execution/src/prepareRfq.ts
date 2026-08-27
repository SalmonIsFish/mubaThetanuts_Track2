/**
 * Alternative execution path: RFQ / OptionFactory, driven the way the MCP
 * "Trade from Chat" plugin actually works (docs.thetanuts.finance/sdk/ai-agents/base-mcp-plugin).
 *
 * Unlike executeMicroTrade.ts (OptionBook, direct SDK signer call), this is
 * the path where Thetanuts MCP's prepare_* tools do the encoding and a
 * SEPARATE signer (Base MCP + Base Account, or this script standing in for
 * it) does the signing. Useful when you need a strike/expiry that isn't
 * currently listed on the book. Slower (~60s for MM offers) and not
 * guaranteed to fill -- keep executeMicroTrade.ts as the demo-day fallback.
 *
 * This script plays the role Base MCP's `send_calls` plays in the chat
 * flow: it takes the `{ chain, calls[] }` envelope the Thetanuts MCP's
 * prepare_* tools return and actually signs + sends it. In the real chat
 * flow, a human clicks "approve" in their wallet at this step -- this
 * script is what CI/automated testing would use instead, so gate the
 * amount tightly (same hard cap pattern as executeMicroTrade.ts).
 *
 * Run this by having Claude (with the `thetanuts` MCP server configured in
 * .mcp.json) call `prepare_request_rfq`, then paste the returned
 * `{ chain, calls }` JSON into RFQ_CALLS_JSON below -- or drive it
 * programmatically via an MCP client SDK instead of copy-paste for a fully
 * automated agent loop.
 */

import "dotenv/config";
import { ethers } from "ethers";
import { requireReadyForExecution } from "./gateClient.js";

const RPC_URL = process.env.THETANUTS_RPC_URL ?? "https://mainnet.base.org";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const GATE_SERVICE_URL = process.env.GATE_SERVICE_URL ?? "http://127.0.0.1:8787";

interface PreparedCall {
  to: string;
  data: string;
  value: string;
}
interface PreparedEnvelope {
  chain: string;
  calls: PreparedCall[];
}

// Populated from the Thetanuts MCP's prepare_request_rfq tool output, plus
// the trade parameters the agent (Claude) used to build that request --
// the gate chain needs the parameters, not just the calldata, since it
// cannot decode Shariah intent from raw calldata.
interface RfqIntent {
  envelope: PreparedEnvelope;
  underlying_symbol: string;
  option_type: "PUT" | "CALL";
  structure: string;
  side: "BUY" | "SELL";
  num_contracts: number;
  strike: number;
  spot_price: number;
  notional_usd: number;
  collateral_token: string;
  required_collateral_amount: number;
}

async function submitPreparedRfq(intent: RfqIntent) {
  if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY not set.");

  const decision = await requireReadyForExecution(GATE_SERVICE_URL, {
    underlying_symbol: intent.underlying_symbol,
    option_type: intent.option_type,
    structure: intent.structure,
    side: intent.side,
    num_contracts: intent.num_contracts,
    strike: intent.strike,
    spot_price: intent.spot_price,
    notional_usd: intent.notional_usd,
    collateral_token: intent.collateral_token,
    posted_collateral_amount: intent.notional_usd,
    required_collateral_amount: intent.required_collateral_amount,
  });
  console.log("Gate chain decision:", decision.decision);
  if (decision.requires_delta_recheck_before_settlement) {
    console.warn(
      "Delta gate ran on a pre-auction moneyness proxy (RFQ has no delta yet). " +
        "Re-run this gate check with the real delta from the winning MM offer BEFORE calling prepare_settle_rfq.",
    );
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== 8453) {
    throw new Error(`Connected to chainId ${network.chainId}, expected Base mainnet (8453).`);
  }

  for (const call of intent.envelope.calls) {
    const tx = await signer.sendTransaction({ to: call.to, data: call.data, value: call.value ?? "0x0" });
    console.log(`Submitted: https://basescan.org/tx/${tx.hash}`);
    await tx.wait();
  }
}

// Example wiring -- replace with the actual prepare_request_rfq output and
// intent parameters before running.
const EXAMPLE_INTENT: RfqIntent = {
  envelope: { chain: "base", calls: [] },
  underlying_symbol: "ETH",
  option_type: "PUT",
  structure: "VANILLA_PUT",
  side: "BUY",
  num_contracts: 1,
  strike: 2800,
  spot_price: 3200,
  notional_usd: 10,
  collateral_token: "USDC",
  required_collateral_amount: 10,
};

if (import.meta.url === `file://${process.argv[1]}`) {
  if (EXAMPLE_INTENT.envelope.calls.length === 0) {
    console.error("EXAMPLE_INTENT.envelope.calls is empty -- paste in a real prepare_request_rfq result first.");
    process.exit(1);
  }
  submitPreparedRfq(EXAMPLE_INTENT).catch((err) => {
    console.error("RFQ submission aborted:", err.message ?? err);
    process.exit(1);
  });
}

export { submitPreparedRfq };
