"""Minimal local HTTP wrapper around gate_coordinator.evaluate_thetanuts_trade.

Runs on localhost only (bind 127.0.0.1). The execution layer
(execution/src/executeMicroTrade.ts) POSTs the proposed trade here and only
proceeds to prepare_approve / fillOrder if decision == "READY_FOR_EXECUTION".
This keeps the gate chain as a separate, independently testable process from
the Node/TS execution script that holds the signer -- the gate never sees a
private key, and the signer script never encodes Shariah/risk logic itself.

Run: uvicorn server:app --host 127.0.0.1 --port 8787
"""

from fastapi import FastAPI
from pydantic import BaseModel

from gate_coordinator import evaluate_thetanuts_trade

app = FastAPI(title="Thetanuts Shariah + Risk Gate Chain")


class TradeRequest(BaseModel):
    underlying_symbol: str
    option_type: str
    structure: str
    side: str
    num_contracts: float
    strike: float | None = None
    spot_price: float | None = None
    notional_usd: float
    notional_usd_today: float = 0.0
    orders_today: int = 0
    chain_id: int = 8453
    collateral_token: str
    posted_collateral_amount: float
    required_collateral_amount: float
    underlying_token_balance: float = 0.0
    cash_collateral: float = 0.0
    uses_borrowed_collateral: bool = False
    routed_through_lending_venue: bool = False
    delta: float | None = None


@app.post("/evaluate")
def evaluate(trade: TradeRequest) -> dict:
    return evaluate_thetanuts_trade(**trade.model_dump())


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
