# Autonomous Quant Agent — Hybrid Execution

Synthesizes `E:\Github2\alpaca-hackathon` (Amanah Trader cash-secured puts, 6 gates, Alpaca API) + `E:\Github2\Ai_Finance_Syariah` (SEC 2-tier Shariah 33%, SMA50/200 breakout S001/S002).

## Architecture

```
fetch bars (Alpaca / Tiingo fixture) 
→ quant S001 trend+breakout (quant_agent.py:181) 
→ syariah SEC tier1 SIC 6020-6036 short-circuit + tier2 33% debt/cash (sec_edgar_screen.py:372)
→ confidence (technical 40% + compliance 30% + liquidity 20% + risk 10%) 
→ 6 gates must PASS (shariah_enhanced, structure, gharar, maysir, riba, risk) 
→ if conf >= AUTO_TRADE_THRESHOLD → auto submit via Alpaca API (alpaca_cli.py:202)
   else → print thesis + input("Confirm trade for AAPL? (y/n)") blocking — human-in-loop
```

All gates stay before execution — threshold only decides **whether to prompt**, not whether to skip gates (safety per alpaca-hackathon/agent/pipeline.py:184).

## Quick Start

```bash
cd quant-agent
cp .env.example .env  # fill ALPACA_API_KEY_ID / SECRET (paper)
pip install -r requirements.txt  # stdlib only, no deps

# Dry run — paper, no submit, shows thesis + auto/manual decision
python agent.py --dry-run

# Live paper submit
python agent.py --live

# Tune threshold without editing code
AUTO_TRADE_THRESHOLD=0.70 python agent.py --dry-run

# Single symbol + custom threshold
python agent.py --dry-run --symbols AAPL --threshold 0.85
```

## Confidence

`confidence.py:score_candidate` — 0-100% from:

- technical: `-breakout_gap_pct` (closer to breakout from below = higher) + `trend_gap_pct` (quant.py:32)
- compliance: `shariah_enhanced` score/100 or SEC PASS=1.0
- liquidity: `1 - spread/15%` + `premium/2` (candidates.py:120)
- risk_headroom: `1 - projected_pct / MAX_POSITION_PCT`

Logged with components for audit (like evidence.py:15 JSONL).

## Human-in-the-Loop (Spec)

```python
# config.py
AUTO_TRADE_THRESHOLD = float(os.getenv("AUTO_TRADE_THRESHOLD", "0.80"))

# agent.py
if confidence >= AUTO_TRADE_THRESHOLD:
    submit_alpaca(...)  # autonomous
else:
    print(json.dumps(thesis, indent=2))
    if input(f"Confirm trade for {sym} conf {confidence:.0%}? (y/n) ") == "y":
        submit_alpaca(...)
```

Change `AUTO_TRADE_THRESHOLD` in `.env` — no code edit.

## Reused Modules

| New | Source |
|---|---|
| `alpaca_client` bars | `Ai_Finance_Syariah/alpaca_market_data.py:129` + `alpaca-hackathon/alpaca_cli.py:99` |
| `quant` SMA/breakout | `Ai_Finance_Syariah/agents/quant_agent.py:32` |
| `syariah` SEC 2-tier | `Ai_Finance_Syariah/sec_edgar_screen.py:372` + `alpaca-hackathon/shariah_enhanced.py:71` |
| `gates` 6 gates | `alpaca-hackathon/agent/gates/*` |
| `scheduler` | `alpaca-hackathon/agent/scheduler.py:19` (add `--loop` later) |

