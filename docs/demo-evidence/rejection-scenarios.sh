#!/usr/bin/env bash
# Rejection demo scenarios -- run live against gate-chain/server.py.
#
# Start the gate chain first: cd gate-chain && uvicorn server:app --host 127.0.0.1 --port 8787
#
# Each scenario is a realistic trade attempt an unguarded AI copilot could
# plausibly propose. The gate chain rejects each for a distinct, named reason
# -- this is the "prove the compliance layer isn't decorative" segment of the
# demo. Run each curl live, on camera, and read the `blockers` +
# `gate_summary` reason back to the room.

GATE_URL="http://127.0.0.1:8787/evaluate"

echo "=================================================================="
echo "Scenario 1 -- Riba (interest): BUIDL, BlackRock's tokenized"
echo "Treasury fund. A real, well-known, institutional product -- an"
echo "unguarded copilot has no reason to flag it. Rejected anyway,"
echo "because the yield paid to holders is interest by construction,"
echo "and this category is hard-rejected in code, not just data."
echo "=================================================================="
curl -s -X POST "$GATE_URL" -H "Content-Type: application/json" -d '{
  "underlying_symbol": "BUIDL",
  "option_type": "PUT",
  "structure": "VANILLA_PUT",
  "side": "BUY",
  "num_contracts": 1,
  "strike": 1,
  "spot_price": 1,
  "notional_usd": 2,
  "chain_id": 8453,
  "collateral_token": "USDC",
  "posted_collateral_amount": 2,
  "required_collateral_amount": 2,
  "delta": -0.35
}'
echo -e "\n"

echo "=================================================================="
echo "Scenario 2 -- Riba via leverage: an ETH put, fully collateralized"
echo "on paper (2 USDC posted, 2 USDC required) -- but the collateral"
echo "is flagged as borrowed. The gate checks the SOURCE of the funds,"
echo "not just whether the number matches."
echo "=================================================================="
curl -s -X POST "$GATE_URL" -H "Content-Type: application/json" -d '{
  "underlying_symbol": "ETH",
  "option_type": "PUT",
  "structure": "VANILLA_PUT",
  "side": "BUY",
  "num_contracts": 1,
  "strike": 2400,
  "spot_price": 2436,
  "notional_usd": 2,
  "chain_id": 8453,
  "collateral_token": "USDC",
  "posted_collateral_amount": 2,
  "required_collateral_amount": 2,
  "uses_borrowed_collateral": true,
  "delta": -0.35
}'
echo -e "\n"

echo "=================================================================="
echo "Scenario 3 -- Maysir (gambling): a deep out-of-the-money ETH put,"
echo "delta -0.03 -- the on-chain analogue of a lottery ticket. Rejected"
echo "for being structurally closer to a wager than a hedge, independent"
echo "of collateral or underlying compliance."
echo "=================================================================="
curl -s -X POST "$GATE_URL" -H "Content-Type: application/json" -d '{
  "underlying_symbol": "ETH",
  "option_type": "PUT",
  "structure": "VANILLA_PUT",
  "side": "BUY",
  "num_contracts": 1,
  "strike": 1200,
  "spot_price": 2436,
  "notional_usd": 2,
  "chain_id": 8453,
  "collateral_token": "USDC",
  "posted_collateral_amount": 2,
  "required_collateral_amount": 2,
  "delta": -0.03
}'
echo -e "\n"

echo "=================================================================="
echo "Scenario 4 -- Risk control: a 50 USD notional attempt against a"
echo "3 USD per-trade cap. Fully compliant otherwise (real underlying,"
echo "real collateral, healthy delta) -- rejected purely on size."
echo "=================================================================="
curl -s -X POST "$GATE_URL" -H "Content-Type: application/json" -d '{
  "underlying_symbol": "ETH",
  "option_type": "PUT",
  "structure": "VANILLA_PUT",
  "side": "BUY",
  "num_contracts": 25,
  "strike": 2400,
  "spot_price": 2436,
  "notional_usd": 50,
  "chain_id": 8453,
  "collateral_token": "USDC",
  "posted_collateral_amount": 50,
  "required_collateral_amount": 50,
  "delta": -0.35
}'
echo -e "\n"
