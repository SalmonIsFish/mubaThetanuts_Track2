"""Deterministic strike-delta band check.

New gate -- no equity equivalent in Ai_Finance_Syariah. Purpose: bound
Gharar from deep-OTM "lottery ticket" strikes, which Maysir.md calls out
specifically ("pure speculation... excessive and artificial risk").
This is a risk-quality control layered on top of the structure gate, not a
standalone fiqh ruling -- it enforces the house policy that a permissible
long option must still resemble a real hedge/position bet, not a
near-zero-probability side bet on price.

Source of the delta figure:
  - OptionBook fills: use the pre-computed Greeks the SDK attaches to each
    order from fetchOrders() (order.delta). Pass it straight through.
  - RFQ: no delta exists pre-auction. Fall back to a moneyness proxy
    (|strike/spot - 1|) as a coarse stand-in until an MM offer is revealed;
    treat the proxy result as advisory only (advisory=True in the response)
    and re-run this check with the real delta once available.
"""


def check_delta(
    *,
    option_type: str,  # "PUT" or "CALL"
    delta: float | None = None,
    strike: float | None = None,
    spot_price: float | None = None,
    min_abs_delta: float = 0.10,
    max_abs_delta: float = 0.90,
) -> dict:
    if delta is not None:
        abs_delta = abs(delta)
        if abs_delta < min_abs_delta:
            return {
                "status": "REJECT",
                "reason": "delta_below_minimum_too_far_otm",
                "abs_delta": abs_delta,
                "min_abs_delta": min_abs_delta,
                "advisory": False,
            }
        if abs_delta > max_abs_delta:
            return {
                "status": "REJECT",
                "reason": "delta_above_maximum_too_far_itm_or_mispriced",
                "abs_delta": abs_delta,
                "max_abs_delta": max_abs_delta,
                "advisory": False,
            }
        return {"status": "PASS", "reason": "delta_within_band", "abs_delta": abs_delta, "advisory": False}

    # RFQ pre-auction fallback: moneyness proxy.
    if strike is None or spot_price is None or spot_price <= 0:
        return {"status": "REJECT", "reason": "delta_and_moneyness_both_unavailable", "advisory": True}

    moneyness = abs((strike / spot_price) - 1)
    # Coarse mapping: >35% away from spot is treated like a sub-0.10-delta
    # lottery strike for this proxy. Deliberately conservative -- re-check
    # with real delta before settlement.
    if moneyness > 0.35:
        return {
            "status": "REJECT",
            "reason": "moneyness_proxy_too_far_otm",
            "moneyness": moneyness,
            "advisory": True,
        }
    return {"status": "PASS", "reason": "moneyness_proxy_within_band", "moneyness": moneyness, "advisory": True}
