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
                                three /converse natural-language conversations)
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
wraps the Thetanuts SDK and the gate chain behind four routes; CORS is open
so any local frontend dev server can call it directly.

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
structure, delta, risk checks) for the frontend to render.

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

Response: `{"txHash", "basescanUrl", "account", "numContractsFilled",
"numContractsFilledHuman", "decision", "gate_summary"}`.

## Official resources

Chain: Base mainnet (8453) · RPC: free Alchemy/Infura key, not the public
endpoint · `npm i -g @thetanuts-finance/cli` for a terminal sanity-check
(`--dry-run` on every command) · docs.thetanuts.finance/for-builders/sdk is
the source of truth if anything here goes stale · help: Telegram
`@ShawnSeanC`, Discord (Thetanuts chatroom in the MUBA server), GitHub
issues on `thetanuts-sdk`.
