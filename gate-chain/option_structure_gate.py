"""Fail-closed Shariah gate for Thetanuts option-structure eligibility.

Adapted from Ai_Finance_Syariah/backend/option_structure_gate.py. Deterministic,
non-AI, and separate from underlying_screen.py and collateral_gate.py -- a
trade needs a PASS from all three (plus delta_gate and risk_checks) before it
reaches the execution layer. See docs/shariah-policy/{Gharar,Maysir,Riba}.md.

Key adaptation from the equity version: "shares_held" (brokerage share
custody) becomes "underlying_token_balance" (wallet/vault balance of the
actual underlying token), and "uses_margin" becomes "uses_borrowed_collateral"
-- same house rule (writing a call requires holding the underlying itself,
not just its USDC value; writing a put requires full USDC collateral),
carried over unchanged from the equity policy notes.

Structures with more than 2 strikes (butterfly, condor, iron condor, Ranger)
are fail-closed REJECTed by default via config.rejected_structures --
Maysir.md flags "financial derivatives... excessive and artificial risk" as
the concern, and a 3-4 leg zone/spread bet is the closest on-chain analogue.
Flip a structure from rejected_structures to allowed_structures only after
an explicit scholar review, same as the dataset-driven pattern elsewhere in
this gate chain.
"""

from config import load_settings

CONTRACT_SCALE = 1  # Thetanuts contracts are unit-denominated (numContracts), no 100x multiplier like equity options


def check_structure(
    *,
    structure: str,
    side: str,  # "BUY" (isLong=true) or "SELL" (isLong=false / writing)
    underlying_token_balance: float = 0.0,
    cash_collateral: float = 0.0,
    strike: float | None = None,
    num_contracts: float = 1,
    uses_borrowed_collateral: bool = False,
) -> dict:
    settings = load_settings()
    normalized_structure = structure.strip().upper()
    normalized_side = side.strip().upper()

    if uses_borrowed_collateral:
        return {"status": "REJECT", "reason": "leveraged_writing_not_permitted", "structure": normalized_structure}

    if normalized_structure in settings.rejected_structures:
        return {"status": "REJECT", "reason": "structure_not_permitted", "structure": normalized_structure}

    if normalized_structure not in settings.allowed_structures:
        return {"status": "REJECT", "reason": "unknown_or_unreviewed_structure", "structure": normalized_structure}

    if normalized_side not in {"BUY", "SELL"}:
        return {"status": "REJECT", "reason": "invalid_side", "structure": normalized_structure}

    # BUY side: fully-paid long position (premium paid upfront via
    # collateral_gate, no leverage). Equivalent to buying an owned asset's
    # optionality -- permissible regardless of an existing hedge position,
    # since the buyer's maximum loss is the premium paid, already collateral-
    # checked, and cannot become a debt obligation.
    if normalized_side == "BUY":
        return {"status": "PASS", "reason": "fully_paid_long_position", "structure": normalized_structure}

    # SELL / writing side: must be covered, not cash-margined-only.
    if "CALL" in normalized_structure:
        required = num_contracts * CONTRACT_SCALE
        if underlying_token_balance >= required:
            return {"status": "PASS", "reason": "covered_by_owned_underlying", "structure": normalized_structure}
        return {"status": "REJECT", "reason": "insufficient_underlying_token_balance", "structure": normalized_structure}

    if "PUT" in normalized_structure:
        if strike is None or strike <= 0:
            return {"status": "REJECT", "reason": "strike_required", "structure": normalized_structure}
        required_cash = num_contracts * CONTRACT_SCALE * strike
        if cash_collateral >= required_cash:
            return {"status": "PASS", "reason": "cash_secured", "structure": normalized_structure}
        return {"status": "REJECT", "reason": "insufficient_cash_collateral", "structure": normalized_structure}

    return {"status": "REJECT", "reason": "structure_side_combination_not_reviewed", "structure": normalized_structure}
