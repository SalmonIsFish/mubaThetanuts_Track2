"""Deterministic tests for the gate chain. No network calls."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gate_coordinator import evaluate_thetanuts_trade  # noqa: E402


def base_kwargs(**overrides):
    kwargs = dict(
        underlying_symbol="ETH",
        option_type="PUT",
        structure="VANILLA_PUT",
        side="BUY",
        num_contracts=1,
        strike=2800,
        spot_price=3200,
        notional_usd=10,
        notional_usd_today=0,
        orders_today=0,
        chain_id=8453,
        collateral_token="USDC",
        posted_collateral_amount=10,
        required_collateral_amount=10,
        delta=-0.35,
    )
    kwargs.update(overrides)
    return kwargs


def test_compliant_buy_put_passes_all_gates():
    result = evaluate_thetanuts_trade(**base_kwargs())
    assert result["decision"] == "READY_FOR_EXECUTION"
    assert result["blockers"] == []


def test_unknown_underlying_rejected():
    result = evaluate_thetanuts_trade(**base_kwargs(underlying_symbol="DOGE"))
    assert result["decision"] == "BLOCKED"
    assert "underlying_rejected" in result["blockers"]


def test_insufficient_collateral_rejected():
    result = evaluate_thetanuts_trade(**base_kwargs(posted_collateral_amount=5))
    assert result["decision"] == "BLOCKED"
    assert "collateral_rejected" in result["blockers"]


def test_borrowed_collateral_rejected():
    result = evaluate_thetanuts_trade(**base_kwargs(uses_borrowed_collateral=True))
    assert result["decision"] == "BLOCKED"
    assert "collateral_rejected" in result["blockers"]
    assert "structure_rejected" in result["blockers"]


def test_iron_condor_rejected_by_default():
    result = evaluate_thetanuts_trade(
        **base_kwargs(structure="IRON_CONDOR", option_type="CALL")
    )
    assert result["decision"] == "BLOCKED"
    assert "structure_rejected" in result["blockers"]


def test_naked_call_write_rejected_without_underlying_balance():
    result = evaluate_thetanuts_trade(
        **base_kwargs(
            structure="VANILLA_CALL",
            option_type="CALL",
            side="SELL",
            underlying_token_balance=0,
        )
    )
    assert result["decision"] == "BLOCKED"
    assert "structure_rejected" in result["blockers"]


def test_covered_call_write_passes_with_underlying_balance():
    result = evaluate_thetanuts_trade(
        **base_kwargs(
            structure="VANILLA_CALL",
            option_type="CALL",
            side="SELL",
            underlying_token_balance=1,
            collateral_token="WETH",
            posted_collateral_amount=1,
            required_collateral_amount=1,
            delta=0.4,
        )
    )
    assert result["decision"] == "READY_FOR_EXECUTION"


def test_deep_otm_delta_rejected():
    result = evaluate_thetanuts_trade(**base_kwargs(delta=-0.03))
    assert result["decision"] == "BLOCKED"
    assert "delta_rejected" in result["blockers"]


def test_over_notional_cap_rejected():
    result = evaluate_thetanuts_trade(**base_kwargs(notional_usd=1000))
    assert result["decision"] == "BLOCKED"
    assert "risk_rejected" in result["blockers"]


def test_non_mainnet_chain_rejected():
    result = evaluate_thetanuts_trade(**base_kwargs(chain_id=84532))  # Base Sepolia
    assert result["decision"] == "BLOCKED"
    assert "risk_rejected" in result["blockers"]


def test_rfq_pregate_uses_moneyness_proxy_and_flags_recheck():
    result = evaluate_thetanuts_trade(**base_kwargs(delta=None, strike=2800, spot_price=3200))
    assert result["requires_delta_recheck_before_settlement"] is True
