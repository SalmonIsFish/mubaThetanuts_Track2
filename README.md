# AI Strategy & Shariah Risk Copilot — Thetanuts on Base

Muba Hacks 2026, Track 02 (AI x Options) and Best Product Built on the
Thetanuts SDK. An AI copilot that recommends Thetanuts option structures on
Base mainnet, gated by a deterministic Shariah + risk chain before any
transaction is signed.

## The problem

No DeFi protocol screens on-chain options for Islamic finance principles —
interest (**Riba**), speculation (**Maysir**), or uncertain contracts
(**Gharar**). Anyone who requires Shariah compliance has nowhere to trade
options on-chain today; that entire user base is locked out.

At the same time, every AI trading copilot on the market makes LLM-driven
trading decisions with no compliance gate. An AI that recommends options
without a deterministic risk check is a liability — it can suggest haram
instruments, deep out-of-the-money "lottery ticket" strikes, or oversized
positions with no guardrails.

## The solution

This copilot recommends Thetanuts option structures on Base mainnet, but
the LLM never makes the compliance call. Every proposed trade must pass
five independent, deterministic gates before anything is signed
(`gate-chain/gate_coordinator.py`):

1. **Underlying screen** — the asset must be Shariah-reviewed and marked
   compliant in `data/crypto-underlying-universe.json`. Missing or
   unmarked data is a reject, never a silent pass.
2. **Collateral gate** — collateral must be self-funded (not borrowed or
   leveraged) and itself Shariah-screened.
3. **Option structure gate** — simple, fully-paid long positions only. No
   naked writing, no multi-leg structures.
4. **Delta gate** — bounds `abs(delta)` to a 0.10–0.90 band, so deep
   out-of-the-money "lottery ticket" strikes (Maysir) are rejected even
   when the underlying and structure are fine.
5. **Risk checks** — hard USD notional caps, daily order-count caps, and
   chain ID verification (Base mainnet, 8453, only).

A trade proceeds only when all five return `PASS`
(`READY_FOR_EXECUTION`). If any gate rejects — or the gate service is
unreachable — the trade is `BLOCKED`. No exceptions, no LLM override; see
`requireReadyForExecution` in `execution/src/gateClient.ts`.

## Who this is for

**Primary:** crypto users who need Shariah screening and currently have
zero on-chain options venues they can use. **Secondary:** DeFi protocols
and DAOs that want compliance rails without building this gate chain
themselves — it's built as infrastructure other teams can sit on top of,
not just a standalone product.

## Demo

**Live app:** https://amanahtrader.uk/thetanuts/ — `gate-chain` 8787 + `execution` 8790 live on VPS, frontend built with `VITE_BASE_PATH=/thetanuts/` + `VITE_API_BASE=/thetanuts/api`.

**Video (90-sec):** https://youtu.be/QqUoHEDs5Kw — screen-record: `GET /market-data` live prices → `POST /propose {"asset":"ETH","optionType":"put","spendUsdc":2}` → `gate_summary` 5 gates `READY/BLOCKED` → `POST /converse "buy an AVAX call with 2 dollars"` → execution dry-run. Replace this placeholder before Sep 6 submission; judges use it as quick reference per Q&A.

**One-slide gate:** 5 gates in order `underlying_screen` → `collateral_gate` → `option_structure_gate` → `delta_gate` → `risk_checks` — only `READY_FOR_EXECUTION` (empty blockers) proceeds; unreachable gate = `BLOCKED` never silent pass (`execution/src/gateClient.ts:requireReadyForExecution`). See diagram below or `GateSpine` header.

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
execution/src/api/server.ts   HTTP API over the execution layer, for a
                               frontend to call (see "HTTP API" below).
.mcp.json       Wires @thetanuts-finance/mcp into Claude as the copilot's
                read/strategy tool-calling layer.
data/           Shariah-reviewed crypto underlying/collateral token universe,
                tagged by category (crypto_native, stablecoin, rwa_debt, ...).
docs/ARCHITECTURE.md          Full design writeup: MCP integration, gate
                               chain adaptation, minimal live-execution path.
docs/RWA_AND_CATEGORIES.md    RWA (Real-World Assets) vs RWA (Risk-Weighted
                               Assets) disambiguation, the asset category
                               taxonomy, and worked RWA examples.
docs/Thetanuts MUBA Hackathon.pdf   The official builder workshop deck.
docs/demo-evidence/            Timestamped proof of the live pipeline (gate-chain
                                tests, connection smoke test, a full /propose
                                dry-run, four live rejection scenarios, and
                                four /converse natural-language conversations,
                                including an adversarial attempt to talk the AI
                                into overriding a compliance result)
                                — see that folder if no signed on-chain trade is present at
                                submission time.
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
cp .env.example .env   # fill in THETANUTS_PRIVATE_KEY (fresh micro-trade wallet only)
npm run smoke-test                                 # no wallet needed -- proves the connection is live
npm run execute:micro-trade -- ETH put 2000000      # 2 USDC, ETH vanilla put

# 4. HTTP API for a frontend -- reads work with no wallet at all
npm run api                                         # listens on http://127.0.0.1:8790 by default
```

See `docs/ARCHITECTURE.md` for why the system is split this way, and for a
fit-check against the official MUBA workshop deck (`Thetanuts MUBA
Hackathon.pdf`) — short version: Track 02 names "an AI strategy or risk
copilot" as an example almost word for word, and judging is three questions
applied to both tracks ("does it work" / "are the options load-bearing" /
"would anyone actually use it").

## HTTP API

`execution/src/api/server.ts` (`npm run api`, port `8790` by default —
override with `API_PORT` in `execution/.env`) is what a frontend calls. It
wraps the Thetanuts SDK and the gate chain behind the routes below; CORS is
open so any local frontend dev server can call it directly.

`gate-chain/server.py` must already be running (`uvicorn server:app --host
127.0.0.1 --port 8787`) — `/propose` and `/execute` both call it, and
`/execute` fails closed (refuses to trade) if it's unreachable.

All bigint fields (order strikes, prices, contract counts, etc.) are
serialized as strings, since JSON has no bigint type.

### `GET /health`
Liveness check. `{"status": "ok"}`.

### `GET /orders?asset=&type=`
Live OptionBook orders. No wallet needed. Both query params are optional;
`asset` is one of `BTC`/`ETH`/`SOL`, `type` is `put`/`call`. Filtering
happens server-side (see the note in `execution/src/tradeResolver.ts` about
why this can't just call the SDK's own `filterOrders()`).

```bash
curl "http://127.0.0.1:8790/orders?asset=ETH&type=put"
# {"count": 51, "orders": [{ "order": {...}, "rawApiData": {...}, ... }]}
```

### `GET /orders/screened?asset=&type=&limit=`
Analytics view: live OptionBook orders, each annotated with its own gate-chain
verdict -- which of what's live on Thetanuts right now actually clears the
Shariah + risk screen, and why (or why not). No wallet needed; nothing is
proposed or matched to a spend amount -- this evaluates orders as they stand,
using a fixed nominal size ($2) only so the BUY-side gates have a number to
evaluate against. Same `asset`/`type` filters as `/orders`; `limit` caps how
many orders get evaluated (default 25, max 100).

```bash
curl "http://127.0.0.1:8790/orders/screened?asset=ETH&limit=10"
# {"count": 10, "compliantCount": 6, "screened": [{ "asset": "ETH", "optionType": "put",
#   "strike": 2400, "decision": "BLOCKED", "blockers": ["delta_rejected"], ... }, ...]}
```

### `GET /market-data`
Live prices for every supported asset. No wallet needed.

```bash
curl http://127.0.0.1:8790/market-data
# {"prices": {"ETH": 2521.31, "BTC": 80390.44, "SOL": 107.29, ...}, "metadata": {...}}
```

### `POST /propose`
Resolves a trade intent against live orders and runs it through the gate
chain — returns the decision without executing anything. No wallet needed.

Body:
```json
{ "asset": "ETH", "optionType": "put", "side": "BUY", "spendUsdc": 2 }
```
`side` must currently be `"BUY"` (OptionBook taker-fill / fully-paid long
only — the only path this API implements so far; see `prepareRfq.ts` for
the RFQ/write side, not yet wired into this API). `spendUsdc` is capped by
`MAX_NOTIONAL_USD_HARD_CAP` (default 3).

```bash
curl -X POST http://127.0.0.1:8790/propose \
  -H "Content-Type: application/json" \
  -d '{"asset":"ETH","optionType":"put","side":"BUY","spendUsdc":2}'
```

Response includes `candidateOrder` (the matched live order), `preview`
(SDK's `previewFillOrder` output) and `numContractsHuman` (a correctly
decimal-scaled contract count — see the scaling note in
`tradeResolver.ts`), `spotPrice`, and the gate chain's own
`decision` (`READY_FOR_EXECUTION` | `BLOCKED`), `blockers`, and full
`gate_summary` (per-gate breakdown — underlying screen, collateral,
structure, delta, risk checks) for the frontend to render. Trimmed real
response (live Base mainnet, order/signature fields shortened):

```json
{
  "candidateOrder": { "order": { "...": "raw SDK order object" }, "rawApiData": { "greeks": { "delta": -0.3223, "iv": 0.3653 } } },
  "preview": { "numContracts": "176455", "pricePerContract": "1133427538", "totalCollateral": "2000000" },
  "numContractsHuman": 0.176455,
  "spotPrice": 2478.25,
  "decision": "READY_FOR_EXECUTION",
  "blockers": [],
  "gate_summary": {
    "underlying_screen": { "status": "PASS", "reason": "token_compliant", "symbol": "ETH", "category": "crypto_native" },
    "collateral_gate": { "status": "PASS", "reason": "fully_collateralized_self_funded", "token": "USDC" },
    "option_structure_gate": { "status": "PASS", "reason": "fully_paid_long_position", "structure": "VANILLA_PUT" },
    "delta_gate": { "status": "PASS", "reason": "delta_within_band", "abs_delta": 0.3223 },
    "risk_checks": { "status": "PASS", "limits": { "max_notional_usd_per_trade": 3, "max_notional_usd_per_day": 10, "max_orders_per_day": 5 } }
  },
  "requires_delta_recheck_before_settlement": false
}
```

A `BLOCKED` response has the same shape with `decision: "BLOCKED"`,
`blockers` populated (e.g. `["delta_rejected"]`), and the failing gate's
own entry in `gate_summary` set to `"status": "REJECT"` with its `reason`
— see the `/orders/screened` example above for a live rejected case.

### `POST /execute`
Same body as `/propose`. The only route that touches the signer — requires
`THETANUTS_PRIVATE_KEY` set on the server (500s with a clear message if
not). Never trusts a prior `/propose` result: re-resolves against live data
first, so a stale proposal can't be replayed at an old price. Only
proceeds past the gate chain if it returns `READY_FOR_EXECUTION`
(`requireReadyForExecution` — fail-closed, throws on `BLOCKED` or if the
gate service is unreachable).

```bash
curl -X POST http://127.0.0.1:8790/execute \
  -H "Content-Type: application/json" \
  -d '{"asset":"ETH","optionType":"put","side":"BUY","spendUsdc":2}'
```

Response shape (same `decision`/`gate_summary` fields as `/propose`, plus
the broadcast result — not captured live here since the demo wallet is
intentionally funded with $0, see `docs/PITCH.md`):

```json
{
  "txHash": "0x...",
  "basescanUrl": "https://basescan.org/tx/0x...",
  "account": "0xYourWalletAddress",
  "numContractsFilled": "176455",
  "numContractsFilledHuman": 0.176455,
  "decision": "READY_FOR_EXECUTION",
  "gate_summary": { "...": "same per-gate breakdown as /propose" }
}
```

### `POST /converse`
Natural language in, a trade proposal or a clarifying question out. Wraps
`/propose`'s same resolve-then-gate-check pipeline behind an LLM extraction
step (`copilot.ts`) — the LLM only ever extracts intent or explains a
verdict already reached by the gate chain; it never makes the compliance
decision itself (see `execution/src/copilot.ts`'s header comment). No
wallet needed — this never executes.

Body:
```json
{ "prompt": "buy an eth put with 2 dollars" }
```

Two response shapes depending on whether the prompt was fully understood.
If it wasn't (missing asset/side/amount, or asks for something this
system can't do — selling, spreads, unsupported assets):

```json
{
  "status": "clarification_needed",
  "actionable_data": null,
  "ai_explanation": "What dollar amount do you want to spend?"
}
```

If it was, real captured response (live Base mainnet, order/signature
fields trimmed):

```json
{
  "status": "ready",
  "actionable_data": {
    "candidateOrder": { "order": { "...": "raw SDK order object" } },
    "preview": { "numContracts": "170259", "totalCollateral": "2000000" },
    "numContractsHuman": 0.170259,
    "spotPrice": 2477.18,
    "blockers": [],
    "gate_summary": { "...": "same per-gate breakdown as /propose" },
    "requires_delta_recheck_before_settlement": false
  },
  "ai_explanation": "The trade involving a put option on Ether (ETH) has been approved and is ready for execution. The underlying asset, ETH, is compliant because it is a native network asset with utility and not a debt instrument. The collateral used, USD Coin (USDC), is also compliant under specific conditions, as it is only used for cash collateral and settlement, without being involved in lending or yield-bearing activities. All necessary checks have passed, confirming that the trade adheres to Shariah principles."
}
```

`status` is `"rejected"` (same `actionable_data` shape, `decision:
"BLOCKED"` inside `gate_summary`) when the gate chain blocks the parsed
intent — `ai_explanation` then names the failing gate and, where the
token has reviewed Shariah rationale on file, explains the actual fiqh
reasoning (Riba/Gharar/Maysir) rather than just restating "rejected".
Requires `OPENROUTER_API_KEY` in `execution/.env` — 500s with a clear
message if unset.

```bash
curl -X POST http://127.0.0.1:8790/converse \
  -H "Content-Type: application/json" \
  -d '{"prompt":"buy an eth put with 2 dollars"}'
```

## Official resources

Chain: Base mainnet (8453) · RPC: free Alchemy/Infura key, not the public
endpoint · `npm i -g @thetanuts-finance/cli` for a terminal sanity-check
(`--dry-run` on every command) · docs.thetanuts.finance/for-builders/sdk is
the source of truth if anything here goes stale · help: Telegram
`@ShawnSeanC`, Discord (Thetanuts chatroom in the MUBA server), GitHub
issues on `thetanuts-sdk`.
