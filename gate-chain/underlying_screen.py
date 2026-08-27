"""Fail-closed Shariah screen for on-chain option underlyings and collateral tokens.

Adapted from Ai_Finance_Syariah/backend/shariah_gate.py. Same fail-closed shape
(dataset missing/inactive/symbol absent -> REJECT), same "PASS requires an
explicit COMPLIANT record" rule -- just keyed on token symbol instead of an
equity ticker, and sourced from data/crypto-underlying-universe.json instead
of the SC Malaysia list.
"""

import json
from pathlib import Path

from config import load_settings


def _load_dataset() -> dict:
    settings = load_settings()
    path = Path(settings.underlying_universe_path)
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8-sig"))


def check_token(symbol: str, *, role: str = "underlying") -> dict:
    """Screen a token symbol for a given role: 'underlying' or 'collateral'.

    role is used only to select which records are eligible -- a
    collateral_only record cannot pass as an underlying and vice versa,
    matching the restriction encoded in the dataset (e.g. USDC is
    collateral_only).
    """
    normalized_symbol = str(symbol or "").strip()
    dataset = _load_dataset()
    if not dataset:
        return {"status": "REJECT", "reason": "universe_not_configured", "symbol": normalized_symbol}

    validation = dataset.get("validation", {})
    if validation.get("status") != "active":
        return {
            "status": "REJECT",
            "reason": "universe_not_active",
            "symbol": normalized_symbol,
            "dataset_status": validation.get("status"),
        }

    record = next(
        (r for r in dataset.get("records", []) if str(r.get("symbol")) == normalized_symbol),
        None,
    )
    if not record:
        return {"status": "REJECT", "reason": "symbol_not_in_universe", "symbol": normalized_symbol}

    record_role = record.get("role", "")
    role_ok = (
        role == "underlying" and record_role in {"underlying", "underlying_or_collateral"}
    ) or (
        role == "collateral" and record_role in {"collateral_only", "underlying_or_collateral"}
    )
    if not role_ok:
        return {
            "status": "REJECT",
            "reason": "symbol_not_eligible_for_role",
            "symbol": normalized_symbol,
            "role_requested": role,
            "role_on_record": record_role,
        }

    status = record.get("shariah_status")
    if status not in {"COMPLIANT", "COMPLIANT_CONDITIONAL"}:
        return {
            "status": "REJECT",
            "reason": "symbol_not_compliant",
            "symbol": normalized_symbol,
            "recorded_status": status,
        }

    result = {
        "status": "PASS",
        "reason": "token_compliant" if status == "COMPLIANT" else "token_compliant_conditional",
        "symbol": normalized_symbol,
        "asset_name": record.get("asset_name"),
    }
    if status == "COMPLIANT_CONDITIONAL":
        result["restrictions"] = record.get("restrictions", [])
    return result
