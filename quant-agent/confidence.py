"""
Confidence Scoring — no ML model exists in either repo (Ai_Finance_Syariah/backend/agents/quant_agent.py:32 is rule-based).
This is a deterministic, interpretable composite that you can later replace with a learned model without touching gates/execution.

Weights: technical 40% + compliance 30% + liquidity 20% + risk_headroom 10%
Mirrors the gate chain so high confidence == actually gate-passable.
"""
from typing import Dict

def score_technical(breakout_gap_pct: float, trend_gap_pct: float) -> float:
    """
    Reuse Ai_Finance_Syariah/backend/agents/quant_agent.py:32 _indicators
    breakout_gap_pct: (close - breakout_level)/breakout_level*100 — 0 is at breakout, negative is below
    trend_gap_pct: (sma50 - sma200)/sma200*100
    Closer to breakout from below is higher score; strong trend adds.
    """
    # breakout proximity: -5% (far) -> 0, 0% (at) -> 1.0, +2% (above) -> 0.8 (chasing)
    if breakout_gap_pct is None:
        return 0.0
    if breakout_gap_pct < -10:
        breakout_score = 0.1
    elif breakout_gap_pct < -5:
        breakout_score = 0.4 + (breakout_gap_pct + 10) * 0.08  # -10->0.4, -5->0.8
    elif breakout_gap_pct <= 0:
        breakout_score = 0.8 + (breakout_gap_pct + 5) * 0.04  # -5->0.8, 0->1.0
    elif breakout_gap_pct <= 3:
        breakout_score = 1.0 - breakout_gap_pct * 0.07  # 0->1.0, 3->0.79
    else:
        breakout_score = 0.5

    trend_score = 1.0 if trend_gap_pct and trend_gap_pct > 1 else 0.6 if trend_gap_pct and trend_gap_pct > 0 else 0.3
    return 0.7 * breakout_score + 0.3 * trend_score

def score_compliance(shariah_status: str, score_pct: float = None) -> float:
    """alpaca-hackathon/agent/gates/shariah_enhanced.py:71 — 85 high, 70 moderate"""
    if shariah_status == "COMPLIANT":
        if score_pct is None:
            return 1.0
        return max(0.6, min(1.0, score_pct / 100))
    if shariah_status in ("REVIEW", "MODERATE"):
        return 0.6
    return 0.0  # FAIL/REJECT → 0, gates will block anyway

def score_liquidity(spread_pct: float, premium: float) -> float:
    """alpaca-hackathon/agent/candidates.py:120 spread <=15%, premium >=0.70"""
    if spread_pct is None or premium is None:
        return 0.5
    spread_score = max(0, 1 - spread_pct / 15.0)
    premium_score = min(1.0, premium / 2.0)  # 0.70->0.35, 2.0->1.0
    return 0.6 * spread_score + 0.4 * premium_score

def score_risk_headroom(projected_pct: float, max_pct: float) -> float:
    """alpaca-hackathon/agent/gates/risk.py:30 — headroom before cap"""
    if max_pct <= 0:
        return 0.0
    ratio = projected_pct / max_pct
    return max(0, 1 - ratio)  # 0% used->1.0, 50%->0.5, 100%->0

def composite(technical: float, compliance: float, liquidity: float, risk: float) -> float:
    return 0.40 * technical + 0.30 * compliance + 0.20 * liquidity + 0.10 * risk

def score_candidate(cand: Dict, quant: Dict, syariah: Dict, risk_proj_pct: float, max_pos_pct: float) -> Dict:
    """
    cand: {otm_pct, spread_pct, premium, dte}
    quant: {breakout_gap_pct, trend_gap_pct}
    syariah: {status, score}
    """
    t = score_technical(quant.get("breakout_gap_pct"), quant.get("trend_gap_pct"))
    c = score_compliance(syariah.get("status", "FAIL"), syariah.get("score"))
    l = score_liquidity(cand.get("spread_pct"), cand.get("premium"))
    r = score_risk_headroom(risk_proj_pct, max_pos_pct)
    conf = composite(t, c, l, r)
    return {
        "confidence": round(min(1.0, max(0.0, conf)), 4),
        "components": {"technical": round(t,3), "compliance": round(c,3), "liquidity": round(l,3), "risk_headroom": round(r,3)},
        "weights": {"technical":0.4,"compliance":0.3,"liquidity":0.2,"risk_headroom":0.1}
    }

if __name__=="__main__":
    # quick sanity
    print(score_candidate({"spread_pct":5,"premium":1.2}, {"breakout_gap_pct":-1.5,"trend_gap_pct":2.1}, {"status":"COMPLIANT","score":85}, 10, 40))
