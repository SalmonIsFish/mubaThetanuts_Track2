"""Coordinate the deterministic gate chain before a Thetanuts trade may execute.

Adapted from Ai_Finance_Syariah/backend/agent_coordinator.py. Same shape:
every sub-gate runs, every result is reported, and the trade is
READY_FOR_EXECUTION only when the blockers list is empty. This function is
the single choke point the execution layer (execution/src/executeMicroTrade.ts)
must call -- via gate-chain/server.py's HTTP wrapper -- before it ever
approves collateral or submits a transaction. Fail-closed: any missing or
malformed input becomes a blocker, never a silent pass.
"""

from collateral_gate import check_collateral
from delta_gate import check_delta
from option_structure_gate import check_structure
from risk_checks import check_order
from underlying_screen import check_token


def evaluate_thetanuts_trade(
    *,
    underlying_symbol: str,
    option_type: str,  # "PUT" or "CALL"
    structure: str,  # e.g. "VANILLA_PUT", "CALL_SPREAD"
    side: str,  # "BUY" or "SELL"
    num_contracts: float,
    strike: float | None,
    spot_price: float | None,
    notional_usd: float,
    notional_usd_today: float,
    orders_today: int,
    chain_id: int,
    collateral_token: str,
    posted_collateral_amount: float,
    required_collateral_amount: float,
    underlying_token_balance: float = 0.0,
    cash_collateral: float = 0.0,
    uses_borrowed_collateral: bool = False,
    routed_through_lending_venue: bool = False,
    delta: float | None = None,
) -> dict:
    underlying = check_token(underlying_symbol, role="underlying")
    collateral = check_collateral(
        collateral_token=collateral_token,
        posted_amount=posted_collateral_amount,
        required_collateral_amount=required_collateral_amount,
        uses_borrowed_collateral=uses_borrowed_collateral,
        routed_through_lending_venue=routed_through_lending_venue,
    )
    structure_result = check_structure(
        structure=structure,
        side=side,
        underlying_token_balance=underlying_token_balance,
        cash_collateral=cash_collateral,
        strike=strike,
        num_contracts=num_contracts,
        uses_borrowed_collateral=uses_borrowed_collateral,
    )
    delta_result = check_delta(
        option_type=option_type,
        delta=delta,
        strike=strike,
        spot_price=spot_price,
    )
    risk = check_order(
        notional_usd=notional_usd,
        notional_usd_today=notional_usd_today,
        orders_today=orders_today,
        chain_id=chain_id,
    )

    blockers = []
    if underlying["status"] != "PASS":
        blockers.append("underlying_rejected")
    if collateral["status"] != "PASS":
        blockers.append("collateral_rejected")
    if structure_result["status"] != "PASS":
        blockers.append("structure_rejected")
    if delta_result["status"] != "PASS":
        blockers.append("delta_rejected")
    if risk["status"] != "PASS":
        blockers.append("risk_rejected")
    if delta_result.get("advisory"):
        # Not a blocker by itself, but the caller (execution layer) must
        # re-run this coordinator with a real delta once the RFQ auction
        # reveals MM pricing, before calling prepare_settle_rfq.
        pass

    decision = "READY_FOR_EXECUTION" if not blockers else "BLOCKED"

    return {
        "decision": decision,
        "blockers": blockers,
        "requires_delta_recheck_before_settlement": bool(delta_result.get("advisory")),
        "gate_summary": {
            "underlying_screen": underlying,
            "collateral_gate": collateral,
            "option_structure_gate": structure_result,
            "delta_gate": delta_result,
            "risk_checks": risk,
        },
    }
