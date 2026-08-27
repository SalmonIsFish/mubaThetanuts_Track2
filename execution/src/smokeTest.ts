/**
 * The 30-second check, straight from the Thetanuts builder workshop deck:
 * no wallet, no signer, no approvals. If this prints live orders and market
 * data, you're connected to the real protocol -- run this before anything
 * else, and run it again if a later step starts throwing mystery timeouts
 * (that's almost always an RPC problem, not a bug in the gate chain or the
 * execution script).
 *
 * This is also the cheapest possible proof for the "does it work" judging
 * question: it demonstrates the SDK is talking to live Base mainnet data
 * with zero risk, before the gate chain or a signer is even in the picture.
 */

import "dotenv/config";
import { ethers } from "ethers";
import { ThetanutsClient } from "@thetanuts-finance/thetanuts-client";

const RPC_URL = process.env.THETANUTS_RPC_URL ?? "https://mainnet.base.org";

async function main() {
  if (RPC_URL === "https://mainnet.base.org") {
    console.warn(
      "Using the public Base RPC -- fine for this one-off check, but get a free " +
        "Alchemy/Infura key (see .env.example) before polling in a loop.",
    );
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const client = new ThetanutsClient({ chainId: 8453, provider });

  const orders = await client.api.fetchOrders();
  console.log(orders.length, "live orders");

  const marketData = await client.api.getMarketData();
  console.log(marketData);

  console.log("\nConnected to live Base mainnet Thetanuts data. Safe to proceed.");
}

main().catch((err) => {
  console.error("Smoke test failed -- not connected to live data:", err.message ?? err);
  process.exit(1);
});
