"""Fail-closed collateral gate for Thetanuts option positions.

New gate (no direct equivalent in Ai_Finance_Syariah -- equities had no
on-chain collateral concept). Enforces the Riba boundary at the collateral
layer: every position must be paid for in full, in an approved token, with
no borrowed/leveraged top-up, and the posted amount must match or exceed the
protocol's own required-collateral figure so the agent cannot under-collateralize
and drift into an implicit debt position.

`required_collateral_amount` should come from the Thetanuts MCP's
`calculate_collateral_required` tool (or `previewFillOrder` /
`calculate_ranger_required_collateral` for their respective structures) --
this gate treats that number as ground truth and does not recompute it.
"""

from underlying_screen import check_token
from config import load_settings


def check_collateral(
    *,
    collateral_token: str,
    posted_amount: float,
    required_collateral_amount: float,
    uses_borrowed_collateral: bool = False,
    routed_through_lending_venue: bool = False,
) -> dict:
    settings = load_settings()

    if uses_borrowed_collateral:
        return {"status": "REJECT", "reason": "borrowed_collateral_not_permitted"}

    if routed_through_lending_venue:
        return {"status": "REJECT", "reason": "lending_venue_routing_not_permitted"}

    normalized_token = str(collateral_token or "").strip().upper()
    if normalized_token not in settings.allowed_collateral_tokens:
        return {
            "status": "REJECT",
            "reason": "collateral_token_not_allowlisted",
            "token": normalized_token,
        }

    token_screen = check_token(normalized_token, role="collateral")
    if token_screen["status"] != "PASS":
        return {
            "status": "REJECT",
            "reason": "collateral_token_failed_screen",
            "token_screen": token_screen,
        }

    if required_collateral_amount is None or required_collateral_amount <= 0:
        return {"status": "REJECT", "reason": "required_collateral_unavailable"}

    if posted_amount is None or posted_amount < required_collateral_amount:
        return {
            "status": "REJECT",
            "reason": "insufficient_collateral_posted",
            "posted_amount": posted_amount,
            "required_collateral_amount": required_collateral_amount,
        }

    # Small tolerance for rounding from decimal conversion (convert_decimals),
    # not a leverage allowance -- posting more than required is fine (it just
    # sits as excess collateral), posting less never is.
    return {
        "status": "PASS",
        "reason": "fully_collateralized_self_funded",
        "token": normalized_token,
        "posted_amount": posted_amount,
        "required_collateral_amount": required_collateral_amount,
        "token_screen": token_screen,
    }
