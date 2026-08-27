# AI Strategy & Shariah Risk Copilot — Thetanuts on Base

Muba Hacks 2026, Track 02 (AI x Options). An AI copilot that recommends
Thetanuts option structures on Base mainnet, gated by a deterministic
Shariah + risk chain before any transaction is signed.

New repository, git history starting 2026-08-27 (hack period: 26 Aug–5 Sep
2026), per the "Development from Scratch" rule. Architecture and Shariah
screening logic are adapted from a private prior project
(`Ai_Finance_Syariah`), reuse confirmed permitted by the organizers.

## Layout

```
gate-chain/     Python — deterministic, fail-closed Shariah + risk gates.
                No LLM in this path. Fully unit-tested (see gate-chain/tests).
execution/      TypeScript — Thetanuts SDK client, the one place a private
                key is touched. Calls gate-chain over local HTTP before
                signing anything.
.mcp.json       Wires @thetanuts-finance/mcp into Claude as the copilot's
                read/strategy tool-calling layer.
data/           Shariah-reviewed crypto underlying/collateral token universe,
                tagged by category (crypto_native, stablecoin, rwa_debt, ...).
docs/ARCHITECTURE.md          Full design writeup: MCP integration, gate
                               chain adaptation, minimal live-execution path.
docs/RWA_AND_CATEGORIES.md    RWA (Real-World Assets) vs RWA (Risk-Weighted
                               Assets) disambiguation, the asset category
                               taxonomy, and worked RWA examples.
```

## Quick start

```bash
# 1. Gate chain (Python)
cd gate-chain && pip install -r requirements.txt
pytest tests/ -q
uvicorn server:app --host 127.0.0.1 --port 8787 &

# 2. Thetanuts MCP for the copilot (Claude Code / Desktop) — see .mcp.json
export THETANUTS_KEYSTORE_MASTER_KEY=$(openssl rand -hex 32)
# paste into .mcp.json's KEYSTORE_MASTER_KEY, or your client's env config

# 3. Execution layer (TypeScript) — the signer boundary
cd ../execution && npm install
cp .env.example .env   # fill in PRIVATE_KEY (micro-trade wallet only)
npm run execute:micro-trade -- ETH put 10000000   # 10 USDC, ETH vanilla put
```

See `docs/ARCHITECTURE.md` for why the system is split this way.
