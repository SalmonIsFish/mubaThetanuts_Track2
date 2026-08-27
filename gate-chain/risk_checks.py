"""Deterministic, non-AI risk checks for a live micro-trade wallet.

Adapted from Ai_Finance_Syariah/backend/risk_checks.py. The equity version
sized limits as a percentage of a paper-trading account's equity; for a
hackathon micro-trade wallet, percentage-of-equity is the wrong shape (the
wallet may hold exactly enough for one trade). Limits are absolute USD
notional caps instead, plus the same daily-order-count cap.
"""

from config import load_settings


def check_order(
    *,
    notional_usd: float,
    notional_usd_today: float,
    orders_today: int,
    chain_id: int,
) -> dict:
    settings = load_settings()

    if settings.require_mainnet and chain_id != 8453:
        return {
            "status": "REJECT",
            "checks": {"mainnet_required": False},
            "reason": "not_base_mainnet",
            "chain_id": chain_id,
        }

    checks = {
        "mainnet_required": (not settings.require_mainnet) or chain_id == 8453,
        "per_trade_notional_cap": notional_usd <= settings.max_notional_usd_per_trade,
        "daily_notional_cap": (notional_usd_today + notional_usd) <= settings.max_notional_usd_per_day,
        "daily_order_cap": orders_today < settings.max_orders_per_day,
    }
    return {
        "status": "PASS" if all(checks.values()) else "REJECT",
        "checks": checks,
        "limits": {
            "max_notional_usd_per_trade": settings.max_notional_usd_per_trade,
            "max_notional_usd_per_day": settings.max_notional_usd_per_day,
            "max_orders_per_day": settings.max_orders_per_day,
        },
    }
