"""Tests for category-aware underlying screening, added 2026-08-27.

Covers the RWA taxonomy: crypto_native still passes as before, rwa_debt is
hard-rejected in code (not just data), and the conditional RWA categories
carry their restrictions through to the caller.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from underlying_screen import check_token, HARD_REJECT_CATEGORIES  # noqa: E402


def test_crypto_native_still_passes():
    result = check_token("ETH", role="underlying")
    assert result["status"] == "PASS"
    assert result["category"] == "crypto_native"


def test_rwa_debt_hard_rejected():
    for symbol in ("BUIDL", "OUSG", "USDY"):
        result = check_token(symbol, role="underlying")
        assert result["status"] == "REJECT", symbol
        assert result["reason"] == "category_structurally_non_compliant"
        assert result["category"] == "rwa_debt"


def test_rwa_debt_is_the_only_hard_reject_category_by_default():
    # Guards against someone silently widening/narrowing the hard-reject set
    # without updating this test and docs/RWA_AND_CATEGORIES.md.
    assert HARD_REJECT_CATEGORIES == frozenset({"rwa_debt"})


def test_rwa_commodity_passes_conditionally_with_restrictions_surfaced():
    result = check_token("PAXG", role="underlying")
    assert result["status"] == "PASS"
    assert result["category"] == "rwa_commodity"
    assert "requires_scholar_review_on_qabd" in result["restrictions"]


def test_rwa_equity_illustrative_record_rejected_pending_issuer_review():
    result = check_token("TOKENIZED-EQUITY-EXAMPLE", role="underlying")
    assert result["status"] == "REJECT"
    assert result["reason"] == "symbol_not_compliant"


def test_unknown_symbol_still_fails_closed():
    result = check_token("SOME_NEW_TOKEN_NOBODY_REVIEWED", role="underlying")
    assert result["status"] == "REJECT"
    assert result["reason"] == "symbol_not_in_universe"
