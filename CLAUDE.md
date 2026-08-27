# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Muba Hacks 2026, Track 02 (AI x Options) submission: an AI copilot that recommends Thetanuts option
structures on Base mainnet (chainId 8453), gated by a deterministic Shariah + risk chain before any
transaction is signed. Real money, real trades — there is no testnet configuration for this SDK.

The repo is two independently-runnable services plus a thin HTTP layer wiring them together for a
frontend:

- **`gate-chain/`** (Python/FastAPI, port 8787) — deterministic Shariah + risk screening. No LLM
  anywhere in this path; every gate is a pure function. Fully unit-tested.
- **`execution/`** (TypeScript) — the Thetanuts SDK client and the *only* place
  `THETANUTS_PRIVATE_KEY` is allowed to exist. Calls `gate-chain` over local HTTP before signing
  anything, and now also exposes an HTTP API (`execution/src/api/server.ts`) for a frontend to call.
- **`.mcp.json`** wires `@thetanuts-finance/mcp` in as the copilot's read/strategy tool-calling layer
  (read + `prepare_*` only — it never signs, never holds a private key).

**Non-negotiable architectural rule**: `gate-chain` is the only thing allowed to approve a trade. No
LLM makes a compliance decision. The execution layer must call the gate chain and treat
`READY_FOR_EXECUTION` as the only green light — an unreachable gate service is a `BLOCKED`, never a
silent pass (see `requireReadyForExecution` in `execution/src/gateClient.ts`).

## Commands

### gate-chain (Python)
```bash
cd gate-chain
pip install -r requirements.txt
pytest tests/ -q                                    # full suite (17 tests)
pytest tests/test_gate_coordinator.py -q             # single file
pytest tests/test_gate_coordinator.py -k some_name   # single test
uvicorn server:app --host 127.0.0.1 --port 8787      # run the gate service
curl http://127.0.0.1:8787/health
```

### execution (TypeScript)
```bash
cd execution
npm install
cp .env.example .env          # fill in THETANUTS_PRIVATE_KEY (fresh micro-trade wallet only)

npm run smoke-test                                 # live-data check, no wallet/signer needed
npm run api                                         # HTTP API for the frontend (port 8790 default)
npm run execute:micro-trade -- ETH put 2000000      # CLI path: 2 USDC, ETH vanilla put
npm run prepare:rfq                                 # RFQ path (see prepareRfq.ts's own instructions)

npx tsc --noEmit               # type-check (see "known issue" below)
```

Run `gate-chain`'s server and `execution`'s API as two separate background processes; the API calls
the gate service over `GATE_SERVICE_URL` (default `http://127.0.0.1:8787`).

**Known environment issue**: `tsx` (used by all the `npm run` scripts above) can OOM/crash on a
memory-constrained machine (Windows, low free RAM) with cryptic errors (V8 heap OOM, Go runtime
thread-creation failure, or `DataCloneError`) — this is a `tsx`/esbuild worker-thread problem, not a
code bug. Workaround: run the file directly with Node's native TS support instead, e.g.
`node --experimental-strip-types --experimental-transform-types src/smokeTest.ts`, or build once with
`npx tsc` (see `tsconfig.json`, `outDir: dist`) and run the plain compiled JS with `node dist/...`.

**Known TS type-check noise**: `npx tsc --noEmit` reports `TS7016: Could not find a declaration file
for module 'ethers'` in every file that imports `ethers` — pre-existing, environment-specific
(`moduleResolution: "Bundler"` not finding `ethers`'s shipped types here), not a real type error.
Ignore it / grep it out when checking for actual new errors.

## Architecture

### Gate chain pipeline (`gate-chain/gate_coordinator.py`)

`evaluate_thetanuts_trade()` runs five independent gates and aggregates blockers — the trade is
`READY_FOR_EXECUTION` only when the blockers list is empty, otherwise `BLOCKED`:

1. `underlying_screen.py` — Shariah-screens a token symbol against
   `data/crypto-underlying-universe.json` (fail-closed: absent/unmarked = REJECT). Category-aware
   (`crypto_native`, `stablecoin`, `rwa_debt`, `rwa_commodity`, `rwa_real_estate`, `rwa_equity` — see
   `docs/RWA_AND_CATEGORIES.md`). `rwa_debt` is **hard-rejected in code**
   (`HARD_REJECT_CATEGORIES`), not just data — a dataset edit alone can't flip it to PASS.
2. `collateral_gate.py` — rejects borrowed/leveraged collateral and any collateral token that isn't
   itself underlying-screened; requires posted collateral ≥ the protocol's own
   `calculate_collateral_required` figure (treated as ground truth, never recomputed here).
3. `option_structure_gate.py` — BUY side (fully-paid long) always passes; SELL/writing requires
   actual backing (owned underlying for a call, cash collateral for a put). Structures beyond 2
   strikes (butterfly/condor/iron condor/ranger) are rejected by default via `config.py`'s
   `rejected_structures`.
4. `delta_gate.py` — bounds `abs(delta)` to a configured band (default 0.10–0.90) to keep out
   deep-OTM "lottery ticket" strikes. RFQ has no pre-auction delta, so it falls back to a moneyness
   proxy and marks the result `advisory: true` — the caller must re-run this gate with the real delta
   once an MM offer reveals it, before final settlement.
5. `risk_checks.py` — absolute USD notional caps (`MAX_NOTIONAL_USD_PER_TRADE`,
   `MAX_NOTIONAL_USD_PER_DAY`), daily order-count cap, and a hard `chain_id == 8453` check.

Everything is env-driven via `gate-chain/config.py` (`load_settings()`), with committed defaults so a
fresh clone runs with no setup — defaults match the workshop guidance verbatim (e.g. 3 USDC per-trade
cap). Fail-closed everywhere: missing config, missing dataset entry, or unreadable input is always
`REJECT`, never a silent pass.

`docs/ARCHITECTURE.md` and several gate-chain docstrings reference `docs/shariah-policy/{Gharar,
Maysir,Riba}.md` — **those files don't currently exist in this repo** (referenced as carried over from
a prior project, not yet copied in). Don't assume they're readable.

### Execution layer (`execution/src/`)

- **`tradeResolver.ts`** — the single source of truth for turning a `{asset, optionType, spendUsdc}`
  intent into a matched live order + gate-chain request. Used by both the CLI script and the HTTP
  API so a fix only has to happen once. Read its header comment before touching order-matching logic
  — it documents two real, verified bugs in the installed `@thetanuts-finance/thetanuts-client@0.3.0`
  SDK that are easy to reintroduce:
  - `client.api.filterOrders(...)` is broken (crashes on any call, even `{}` — reads
    `response.orders` but the indexer returns `{data: {orders: [...]}}`) and the indexer also ignores
    the `asset`/`type` filter params server-side. **Never call `filterOrders()`** — use the exported
    `findLiveOrders()`, which filters `fetchOrders()` output client-side instead.
  - Filtering by underlying asset can't use `order.underlyingToken` — the SDK's own
    `deriveUnderlyingFromPriceFeed` helper only maps BTC/ETH; SOL resolves to the zero address.
    `findLiveOrders()` matches `rawApiData.priceFeed` against `client.chainConfig.priceFeeds` instead,
    which does cover all three assets.
  - `previewFillOrder()`'s returned `numContracts` is scaled by 1e6 (USDC's decimals) here, **not**
    the 18-decimal convention the SDK's general docs describe for on-chain `Order.numContracts`. Use
    the exported `numContractsHuman()` helper rather than dividing by a guessed decimal count.
- **`jsonSafe.ts`** — every HTTP response must go through this; `Order.expiry/numContracts/price/
  strikes` and `previewFillOrder`'s return are real `bigint`s and `JSON.stringify` throws on them
  otherwise.
- **`gateClient.ts`** — the only way to talk to `gate-chain`. `evaluateTrade()` (non-throwing, returns
  a decision to render) vs `requireReadyForExecution()` (throwing, fail-closed — use this immediately
  before any signing action).
- **`api/server.ts`** — Express HTTP API for a frontend: `GET /orders`, `GET /market-data` (read-only,
  no signer needed), `POST /propose` (resolves + gate-checks, returns the decision without executing),
  `POST /execute` (the only route that constructs a signer client — lazily, inside the handler, never
  at module load; requires `THETANUTS_PRIVATE_KEY`). `/execute` never trusts a client-supplied prior
  `/propose` result — it re-resolves against live data so a stale proposal can't be replayed at an old
  price.
- **`executeMicroTrade.ts`** / **`prepareRfq.ts`** — CLI equivalents of the OptionBook and RFQ paths
  respectively (see `docs/ARCHITECTURE.md` for why there are two paths and when to use which).
  `executeMicroTrade.ts` is the demo-day default: OptionBook fills an already-posted order in one
  transaction, no waiting; RFQ needs ~60s for market maker offers and isn't guaranteed to fill.

Before trusting any new field path against the SDK, verify it against the actually-installed types —
`execution/node_modules/@thetanuts-finance/thetanuts-client/dist/index.d.ts` — or a live call, not
prose docs; the SDK's own docs have already been wrong twice in this codebase (see above). The MCP
server's `get_sdk_context` tool is a good first pass but is not a substitute for checking the
installed `.d.ts` when something doesn't line up with a live response.

### Safety invariants that must not be relaxed

- The private key (`THETANUTS_PRIVATE_KEY`) exists only in `execution/src/*.ts` — never in
  `gate-chain`, never in `.mcp.json`, never in the copilot's context, never logged.
- A trade only proceeds past `requireReadyForExecution` — an unreachable gate service is a blocker,
  not a skip.
- Trade size: 1–3 USDC per the workshop guidance, enforced twice — `gate-chain`'s own
  `MAX_NOTIONAL_USD_PER_TRADE` and `execution`'s independent client-side
  `MAX_NOTIONAL_USD_HARD_CAP` — so a gate-chain misconfiguration alone can't authorize a large trade.
- `chain_id` must resolve to `8453` (Base mainnet) — checked independently in both the execution
  layer (`provider.getNetwork()`) and `gate-chain/risk_checks.py`.
