#!/usr/bin/env python3
"""
Hybrid Autonomous Quant Agent — Thetanuts edition (no Alpaca)

Flow (mirrors Thetanuts gate-chain + Ai_Finance_Syariah quant):
  fetch Thetanuts market-data / orders → quant S001 trend/breakout (synthesized bars) → syariah screen (crypto-universe 6 assets) → confidence → gate-chain 5 gates → Thetanuts execution

Human-in-loop:
  conf >= AUTO_TRADE_THRESHOLD (0.80) → autonomous via Thetanuts POST /execute (execution/src/api/server.ts)
  conf < threshold → print thesis + blocking input("Confirm trade for ETH? (y/n)")

Usage:
  python agent.py --dry-run          # paper, no submit, shows thesis
  python agent.py --live             # hits Thetanuts execution API (needs THETANUTS_PRIVATE_KEY in execution/.env, but wallet stays 0 for demo)
  AUTO_TRADE_THRESHOLD=0.70 python agent.py --dry-run
"""
import os, sys, json, argparse, time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from pathlib import Path

ROOT = Path(__file__).parent
sys.path.insert(0, str(Path("/mnt/e/Github2/Ai_Finance_Syariah")))

from config import get_settings
import confidence

# --- Thetanuts assets (execution/src/tradeResolver.ts:15 SUPPORTED_ASSETS) ---
WATCHLIST = ["BTC","ETH","SOL","AVAX","XRP","BNB"]

def _is_market_hours():
    # Crypto 24/7, but keep ET check for demo loop compatibility
    return True

def fetch_bars_thetanuts(symbol: str):
    """Synthetic bars for Thetanuts underlying — SMA200 needs 200, S001 fires for demo cohort; live spot fetched from execution API when available"""
    s=get_settings()
    # Try live spot from execution API to anchor fixture, else fallback
    base_map={"BTC":79000,"ETH":2450,"SOL":101,"AVAX":7.3,"XRP":1.4,"BNB":715}
    base=base_map.get(symbol, 150)
    closes=[]
    for i in range(250):
        closes.append(base * (1 + i*0.0006) + (i%7)*0.02)
    if symbol in ("BTC","ETH","SOL","AVAX"):
        closes[-1]=max(closes[-56:-1]) + base*0.002
        closes[-2]=closes[-1]- base*0.001
    bars=[{"c": c, "close": c, "t": f"2026-09-{i%28+1:02d}"} for i,c in enumerate(closes)]
    # Overlay live spot if execution API reachable
    try:
        import urllib.request
        with urllib.request.urlopen(f"{s.execution_api_url}/market-data", timeout=5) as r:
            j=json.loads(r.read())
            spot=j.get("prices",{}).get(symbol)
            if spot:
                # Rebase last close to live spot
                factor=spot/closes[-1]
                for b in bars:
                    b["c"]*=factor
                    b["close"]*=factor
    except Exception:
        pass
    return bars

def indicators(closes):
    if len(closes) < 200:
        return None
    sma50=sum(closes[-50:])/50
    sma200=sum(closes[-200:])/200
    breakout_level=max(closes[-56:-1]) if len(closes)>=56 else max(closes)
    latest=closes[-1]
    trend_ok=sma50 > sma200
    breakout_ok=latest >= breakout_level
    breakout_gap=(latest - breakout_level)/breakout_level*100 if breakout_level else 0
    trend_gap=(sma50 - sma200)/sma200*100 if sma200 else 0
    return {"sma50":sma50,"sma200":sma200,"breakout_level":breakout_level,"latest_close":latest,"trend_ok":trend_ok,"breakout_ok":breakout_ok,"breakout_gap_pct":breakout_gap,"trend_gap_pct":trend_gap}

def evaluate_s001(closes):
    ind=indicators(closes)
    if not ind: return {"signal":"NO_SIGNAL","reason":"need 200 bars","ind":None}
    if ind["trend_ok"] and ind["breakout_ok"]:
        return {"signal":"BUY","reason":f"trend {ind['trend_gap_pct']:.1f}% + breakout {ind['breakout_gap_pct']:.1f}%","ind":ind}
    return {"signal":"NO_SIGNAL","reason":f"trend_ok={ind['trend_ok']} breakout_ok={ind['breakout_ok']}","ind":ind}

def screen_symbol(symbol):
    """Crypto syariah via data/crypto-underlying-universe.json + gate-chain underlying_screen (crypto_native COMPLIANT)"""
    try:
        import json as J
        p=Path(__file__).parent / "../data/crypto-underlying-universe.json"
        if not p.exists():
            p=Path("/mnt/e/Github2/mubaThetanuts_Track2/data/crypto-underlying-universe.json")
        j=J.loads(p.read_text())
        rec=next((r for r in j.get("records",[]) if r.get("symbol")==symbol), None)
        if rec and rec.get("shariah_status")=="COMPLIANT":
            return {"status":"COMPLIANT","score":85,"provider":"CRYPTO_UNIVERSE"}
        if rec:
            return {"status":rec.get("shariah_status","REVIEW"),"score":50,"provider":"CRYPTO_UNIVERSE"}
    except Exception as e:
        print(f"  ! crypto screen failed for {symbol}: {e}")
    return {"status":"REVIEW","score":50,"provider":"FALLBACK"}

def build_mock_candidates(symbol, closes):
    q=evaluate_s001(closes)
    if q["signal"]!="BUY":
        return None
    ind=q["ind"]
    spot=ind["latest_close"]
    otm_pct=3.0
    strike=round(spot * (1 - otm_pct/100), 2)
    # Vary liquidity to demo both auto and manual thresholds
    spread_map={"BTC":3.5,"ETH":3.5,"SOL":4.0,"AVAX":11.5,"XRP":12.0,"BNB":4.2}
    premium_map={"BTC":1.4,"ETH":1.4,"SOL":1.3,"AVAX":0.80,"XRP":0.75,"BNB":1.3}
    spread=spread_map.get(symbol, 4.5)
    premium=premium_map.get(symbol, 1.2)
    # Alternate put/call for variety: even hash -> put, odd -> call (screened same)
    import hashlib
    is_put = int(hashlib.md5(symbol.encode()).hexdigest(),16) % 2 == 0
    return {"symbol":symbol,"strike":strike,"dte":5,"otm_pct":otm_pct,"premium":premium,"spread_pct":spread,"spot":spot,"quant":q, "optionType": "put" if is_put else "call"}

def submit_thetanuts(symbol, optionType, strike, spendUsdc=2, dry_run=True):
    s=get_settings()
    payload={"asset":symbol,"optionType":optionType,"side":"BUY","spendUsdc":spendUsdc}
    if dry_run:
        print(f"  [DRY RUN] would POST {s.execution_api_url}/propose {payload} (gate-chain 5 gates)")
        # Show what live would do
        try:
            import urllib.request
            data=json.dumps(payload).encode()
            req=urllib.request.Request(f"{s.execution_api_url}/propose", data=data, headers={"Content-Type":"application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=10) as r:
                j=json.loads(r.read())
                print(f"  → gate {j.get('decision')} blockers {j.get('blockers')} delta {j.get('gate_summary',{}).get('delta_gate',{}).get('abs_delta')}")
        except Exception as e:
            print(f"  ! propose dry-run gate check failed: {e}")
        return {"dry":True}
    # Live — hits execution API /execute (needs THETANUTS_PRIVATE_KEY, but wallet is 0 for demo so will return insufficient funds, not compliance bypass)
    import urllib.request
    data=json.dumps(payload).encode()
    req=urllib.request.Request(f"{s.execution_api_url}/execute", data=data, headers={"Content-Type":"application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def run_once(dry_run=True, symbols=None, spendUsdc=2):
    s=get_settings()
    thresh=s.auto_trade_threshold
    symbols=symbols or WATCHLIST
    print(f"\n=== Quant Agent (Thetanuts) run {datetime.now(timezone.utc).isoformat()} threshold {thresh:.0%} dry_run={dry_run} spend ${spendUsdc} ===")
    for sym in symbols:
        print(f"\n[{sym}] fetching bars...")
        bars=fetch_bars_thetanuts(sym)
        closes=[b["close"] for b in bars]
        cand=build_mock_candidates(sym, closes)
        if not cand:
            print(f"  -> NO_SIGNAL (trend/breakout not met) — skipping")
            continue
        syariah=screen_symbol(sym)
        print(f"  Syariah: {syariah['status']} via {syariah['provider']} ({syariah.get('score')})")
        if syariah["status"] not in ("COMPLIANT","PASS"):
            print(f"  -> REJECTED_BY_GATE (syariah) — not submitting")
            continue
        risk_proj_pct=5.0
        conf_info=confidence.score_candidate(cand, cand["quant"]["ind"], syariah, risk_proj_pct, s.max_position_pct)
        conf=conf_info["confidence"]
        thesis={"symbol":sym,"optionType":cand["optionType"],"strike":cand["strike"],"dte":cand["dte"],"otm":cand["otm_pct"],"premium":cand["premium"],"quant_reason":cand["quant"]["reason"],"syariah":syariah,"confidence":conf,"components":conf_info["components"]}
        print(f"  Thesis: {sym} {cand['optionType']} ${cand['strike']} OTM{cand['otm_pct']}% premium ${cand['premium']} | {cand['quant']['reason']} | conf {conf:.0%} {conf_info['components']}")

        if conf >= thresh:
            print(f"  -> AUTO_SUBMIT (conf {conf:.0%} >= {thresh:.0%}) autonomous via Thetanuts")
            submit_thetanuts(sym, cand["optionType"], cand["strike"], spendUsdc=spendUsdc, dry_run=dry_run)
        else:
            print(f"  -> NEEDS_APPROVAL (conf {conf:.0%} < {thresh:.0%}) — halting")
            print(f"     Thesis JSON: {json.dumps(thesis, indent=2)}")
            try:
                ans=input(f"Confirm trade for {sym} {cand['optionType']} ${cand['strike']} conf {conf:.0%}? (y/n): ").strip().lower()
            except EOFError:
                ans="n"
            if ans=="y":
                print(f"  -> MANUALLY_APPROVED by human")
                submit_thetanuts(sym, cand["optionType"], cand["strike"], spendUsdc=spendUsdc, dry_run=dry_run)
            else:
                print(f"  -> REJECTED_BY_HUMAN")

def main():
    ap=argparse.ArgumentParser(description="Autonomous Quant Agent — Thetanuts hybrid execution")
    ap.add_argument("--dry-run", action="store_true", help="paper, no submit, show thesis")
    ap.add_argument("--live", action="store_true", help="force live submit (hits Thetanuts /execute, needs funded wallet)")
    ap.add_argument("--symbols", nargs="+", default=None, help="override watchlist, e.g. BTC ETH")
    ap.add_argument("--spend", type=float, default=2, help="spendUsdc per trade 1-3 (gate cap)")
    ap.add_argument("--threshold", type=float, default=None, help="override AUTO_TRADE_THRESHOLD 0.80")
    args=ap.parse_args()

    s=get_settings()
    if args.threshold is not None:
        s.auto_trade_threshold=args.threshold
    dry_run = not args.live
    if args.dry_run: dry_run=True

    run_once(dry_run=dry_run, symbols=args.symbols, spendUsdc=args.spend)

if __name__=="__main__":
    main()
