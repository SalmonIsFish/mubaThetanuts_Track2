/**
 * Thin client for the Python gate-chain service (gate-chain/server.py).
 *
 * This is the ONLY function the execution script is allowed to trust for a
 * go/no-go decision. It never re-implements Shariah or risk logic locally --
 * that logic lives once, in Python, next to the tests that prove it.
 */

export interface GateTradeRequest {
  underlying_symbol: string;
  option_type: "PUT" | "CALL";
  structure: string;
  side: "BUY" | "SELL";
  num_contracts: number;
  strike?: number | null;
  spot_price?: number | null;
  notional_usd: number;
  notional_usd_today?: number;
  orders_today?: number;
  chain_id?: number;
  collateral_token: string;
  posted_collateral_amount: number;
  required_collateral_amount: number;
  underlying_token_balance?: number;
  cash_collateral?: number;
  uses_borrowed_collateral?: boolean;
  routed_through_lending_venue?: boolean;
  delta?: number | null;
}

export interface GateDecision {
  decision: "READY_FOR_EXECUTION" | "BLOCKED";
  blockers: string[];
  requires_delta_recheck_before_settlement: boolean;
  gate_summary: Record<string, unknown>;
}

export async function evaluateTrade(
  gateServiceUrl: string,
  trade: GateTradeRequest,
): Promise<GateDecision> {
  const response = await fetch(`${gateServiceUrl}/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(trade),
  });

  if (!response.ok) {
    throw new Error(`Gate service returned HTTP ${response.status}: ${await response.text()}`);
  }

  return (await response.json()) as GateDecision;
}

/** Fail closed if the gate service is unreachable -- never treat "no answer" as a pass. */
export async function requireReadyForExecution(
  gateServiceUrl: string,
  trade: GateTradeRequest,
): Promise<GateDecision> {
  let result: GateDecision;
  try {
    result = await evaluateTrade(gateServiceUrl, trade);
  } catch (err) {
    throw new Error(
      `Gate service unreachable at ${gateServiceUrl} -- refusing to execute (fail-closed). Underlying error: ${err}`,
    );
  }

  if (result.decision !== "READY_FOR_EXECUTION") {
    throw new Error(`Gate chain BLOCKED this trade: ${result.blockers.join(", ")}`);
  }

  return result;
}
