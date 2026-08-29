# Architecture: AI Strategy & Shariah Risk Copilot for Thetanuts

Answers the three integration questions for Track 02, grounded in the actual
Thetanuts V4 SDK/MCP docs (docs.thetanuts.finance/sdk, fetched 2026-08-27),
the official MUBA builder workshop deck ("Thetanuts MUBA Hackathon.pdf",
attended 2026-08-27), and the gate-chain design carried over from
`Ai_Finance_Syariah`.

## Fit check against the official workshop deck

Track 02's own example list, verbatim: "Natural-language trading," "**an AI
strategy or risk copilot**," "an autonomous hedging agent — placing real
trades on OptionBook or OptionFactory." This project is the second example,
close to word for word — no pivot indicated by the workshop material.

Judging is three questions, applied to both tracks, per the organizer's own
builder doc ("Thetanuts MUBA Hackathon Builder Docs"): **"Does it work?"**
(a real running product, not a mockup), **"Are the options load-bearing?"**
("if it would work identically with the Thetanuts calls stubbed out, it
isn't really using on-chain options" — this is not Track-1-only, it's
listed as a criterion for both tracks), and **"Does it fit the market?"**
(who's it for, why over what exists, does it scale — "a couple of honest
sentences beats a business plan"). For us, "load-bearing" means the
copilot's read/strategy calls (market data, order matching, collateral
calc) and the gate chain's own inputs need to be genuinely live-sourced
throughout, not just at the final `/execute` call — a real trade against
live pricing is meaningless if the numbers feeding the gate chain aren't
actually coming from a live `fetchOrders`/`calculate_collateral_required`
call at demo time.

**Update, 2026-08-29 (organizer clarification, Discord):** Shawn confirmed a
signed on-chain broadcast is optional, not a hard gate — "if you don't want
to use it, that's also fine, you can explain your ideas and don't need to
run the demo on it. As long as the idea & build reaches them, they will
judge fairly." This project takes the honest middle path rather than either
extreme: the full pipeline (live SDK connection, live order matching, live
gate-chain evaluation against real market data) is proven end-to-end and
captured in `docs/demo-evidence/`, stopping one signature short of an actual
broadcast. See that file for exactly how far it got and why. The
"load-bearing" bar above still fully applies to everything up to that point
— it's the final signed transaction specifically that's now optional.

Our answer to "would anyone actually use it": nobody else at this hackathon
will have a compliance layer, and there's a real, currently-locked-out user
base behind it — on-chain options are structurally unusable by anyone who
needs Shariah compliance today, because no protocol has this layer. That's
the two-sentence pitch, not a fiqh lecture.

The deck also confirms: "Nothing stops one entry taking both tracks" — a
lightweight Track 1 angle (e.g. an analytics view of what's currently
Shariah-screenable on Thetanuts) is a possible bonus if time allows, not a
requirement. And: "If you plan to keep building it, tell us... serious
builders only" — worth having ready, since this genuinely extends
pre-hackathon conviction rather than being invented for the pitch.

## 1. `@thetanuts-finance/mcp` as the primary tool-calling layer

The Thetanuts MCP server ships with the SDK and exposes roughly 100 tools
over stdio: `npx -y @thetanuts-finance/mcp`. It is deliberately **read +
prepare only** — it never holds a private key, never signs, never
broadcasts. `prepare_*` tools return an unsigned `{ chain, calls[] }`
envelope; something else has to sign it. That split is the whole reason the
architecture below has two separate processes (MCP-facing copilot vs.
signer script) instead of one.

Wire it into Claude via `.mcp.json` at the repo root:

```json
{
  "mcpServers": {
    "thetanuts": {
      "command": "npx",
      "args": ["-y", "@thetanuts-finance/mcp"],
      "env": {
        "THETANUTS_RPC_URL": "https://mainnet.base.org",
        "KEYSTORE_MASTER_KEY": "<32-byte hex, openssl rand -hex 32>"
      }
    }
  }
}
```

`KEYSTORE_MASTER_KEY` is not a wallet key — it encrypts a local SQLite
keystore of ECDH keys the RFQ system uses so market makers can send you
encrypted offers. It cannot move funds.

**Tool categories relevant to the copilot** (from the MCP server's own tool
list):

| Category | Tools | Used for |
|---|---|---|
| LLM context | `get_sdk_context` | Call once per session, cache it — gives Claude the full SDK reference without you writing a system prompt by hand |
| Market & orders | `get_market_data`, `fetch_orders`, `filter_orders` | Strategy recommendation input |
| MM pricing | `get_mm_all_pricing`, `get_mm_ticker_pricing`, `get_mm_spread_pricing` | Pricing for both OptionBook and RFQ |
| Calculation | `calculate_collateral_required`, `calculate_premium_per_contract`, `calculate_num_contracts` | Feeds numbers straight into the gate chain (below) — the copilot should never eyeball these |
| Validation | `validate_butterfly`, `validate_condor`, `validate_iron_condor` | Structural sanity before even reaching the Shariah gate |
| Prepare (write) | `prepare_request_rfq`, `prepare_approve`, `prepare_settle_rfq`, `prepare_cancel_rfq` | RFQ write path — calldata only, never signs |

**Copilot system-prompt rule, non-negotiable:** Claude may call any read /
`get_*` / `calculate_*` / `validate_*` tool freely. Claude may call a
`prepare_*` tool only after presenting the trade parameters back to the user
in chat and stating the gate-chain result. Claude must never be given
`THETANUTS_PRIVATE_KEY` or any signer capability — that lives only in
`execution/src/*.ts`, a process the copilot cannot reach.

Two other CLI-adjacent surfaces worth knowing about, both confirmed in the
workshop deck: `npm i -g @thetanuts-finance/cli` (binary `thetanuts`, global
`--dry-run` flag on every command, `thetanuts wallet create` for a
disposable demo wallet) is a fast way to sanity-check a quote or fill from
the terminal before wiring it into the copilot. `get_sdk_context` (an MCP
tool) or `llms-full.txt` (in the SDK repo root) is what to feed a coding
agent that starts inventing method names instead of using the real SDK
surface.

Two ways to actually get a signature, per the SDK's own "AI Agents" docs:

- **Trade from chat** (recommended for the hackathon demo): pair Thetanuts
  MCP with Base MCP. Claude prepares calldata, Base MCP's `send_calls` hands
  it to Base Account, a human clicks approve. Zero custom signer code, but a
  human has to be present at demo time.
- **This repo's `execution/` scripts**: a small TypeScript process holds
  `THETANUTS_PRIVATE_KEY` directly and calls the SDK's write methods (`fillOrder`,
  `sendTransaction` on prepared calldata) after asking the gate chain. No
  human click needed at trade time — useful for an unattended demo run, but
  it's your key, your responsibility. This is what `npm run
  execute:micro-trade` runs.

Either way, the MCP server itself never becomes the signing boundary — that
property is what "primary tool-calling layer" should mean here: Claude's
*reasoning and read access* go through MCP; *signing* stays outside it,
in a component you can audit independently of the LLM.

## 2. Adapting the gate chain to Thetanuts option positions

`Ai_Finance_Syariah/backend/{shariah_gate,option_structure_gate,risk_checks,
agent_coordinator}.py` is a four-stage deterministic pipeline: underlying
screen → structure permissibility → risk limits → coordinator that
aggregates blockers. That shape carries over almost unchanged; what changes
is the substance of each stage, because the domain moved from US equities
via a brokerage to collateralized options on an EVM options protocol.

| Stage | Equity version | Thetanuts version | Why it changed |
|---|---|---|---|
| Underlying screen | SC Malaysia ticker list, dataset-driven, fail-closed | `data/crypto-underlying-universe.json` — BTC/ETH/SOL/cbBTC/WETH COMPLIANT, USDC COMPLIANT_CONDITIONAL (collateral-only, never routed to lending) | No equivalent "compliant issuer list" exists for crypto; had to write one, same fail-closed shape (absent or unmarked = REJECT) |
| Structure gate | `shares_held` proves coverage for a covered call | `underlying_token_balance` (wallet/vault balance of the actual token) | Brokerage share custody → on-chain token balance is a direct swap |
| Structure gate | `uses_margin` flag rejects margin-financed trades outright | `uses_borrowed_collateral` flag | Same Riba concern, different mechanism (margin account vs. flash-loaned/borrowed collateral) |
| — | *(none — brokerage enforced collateral itself)* | **`collateral_gate.py` (new)** | Thetanuts is self-custodial: nothing stops an agent from posting less than required collateral except code you write. `calculate_collateral_required` (MCP) is treated as ground truth; the gate rejects any post below it, any borrowed-collateral flag, and any collateral token that isn't itself underlying-screened |
| — | *(none)* | **`delta_gate.py` (new)** | Deep-OTM strikes are the on-chain analogue of the "lottery ticket" Gharar concern `Maysir.md` calls out by name. Bounds `abs(delta)` to a configured band; for RFQ (no delta pre-auction) falls back to a moneyness proxy and flags the result `advisory: true` so the coordinator knows to re-check once a real delta exists |
| Risk checks | % of paper-account equity (`MAX_POSITION_PCT` etc.) | Absolute USD notional caps (`MAX_NOTIONAL_USD_PER_TRADE`, `MAX_NOTIONAL_USD_PER_DAY`) + a hard `chain_id == 8453` check | A fresh micro-trade wallet doesn't have a meaningful "% of equity" — and mainnet vs. testnet is a new failure mode that didn't exist for a brokerage account |
| Coordinator | `evaluate_candidate()` aggregates blockers, `READY_FOR_APPROVAL` / `BLOCKED` | `evaluate_thetanuts_trade()` — same aggregation shape, `READY_FOR_EXECUTION` / `BLOCKED`, plus `requires_delta_recheck_before_settlement` | Same pattern, new field to carry the RFQ two-phase-pricing wrinkle through to the execution layer |

What deliberately did **not** change: fail-closed defaults everywhere
(missing config, missing dataset entry, or unreadable input is always
`REJECT`, never a silent pass), no LLM anywhere in this path (every gate is
a pure function you can unit test without a network call — see
`gate-chain/tests/`, 17 tests, all passing), and the house policy that
*writing* an option requires actual backing (token balance for a call, cash
for a put) rather than mere cash-margin sufficiency — carried over unchanged
from the equity `SHARIAH_GATE_NOTES.md` rationale.

A third category was added after the underlying screen shipped: RWA
(Real-World Assets) tagging. See `docs/RWA_AND_CATEGORIES.md` — short
version, tokenized debt (Treasuries, private credit) is hard-rejected in
code regardless of dataset edits, since it's interest-bearing by
construction; commodities and real estate get a conditional pass pending
scholar review; nothing in this category is actually listed as a Thetanuts
underlying yet, so treat it as architecture readiness, not a live claim.

One structural point worth flagging explicitly: RFQ/Factory trades are
**already 100% protocol-enforced collateralized** ("every option created
through the factory is 100% collateralized," per the SDK docs) — so
`collateral_gate.py` is not preventing under-collateralization the protocol
would otherwise allow; it's verifying the *token* posted is itself
Shariah-screened and that the agent isn't funding that collateral through a
borrowed/leveraged path upstream of the protocol (e.g. a flash loan or a
lending-market draw) that the protocol has no visibility into.

## 3. Minimal execution path to a live micro-trade on Base mainnet

Two products, two different minimum paths — pick based on demo-day risk
tolerance:

**OptionBook (`execution/src/executeMicroTrade.ts`) — recommended for the
hackathon demo.** Fills an already-posted maker order in one transaction, no
waiting. This is the path the SDK's own quick-start example uses:

```
fetchOrders()                    -- browse live maker orders (read, no signer)
  -> previewFillOrder()          -- dry-run: contracts, collateral, price (read, no signer)
  -> gate_coordinator.evaluate_thetanuts_trade()   -- MUST return READY_FOR_EXECUTION
  -> erc20.ensureAllowance()     -- approve USDC spend to the OptionBook contract
  -> optionBook.fillOrder()      -- the one transaction that actually trades
```

Note this path does **not** go through the Thetanuts MCP's `prepare_*`
tools at all — OptionBook has no `prepare_fill_order` tool; only RFQ writes
are MCP-exposed (per the Base MCP plugin docs: "OptionBook fills are
deliberately not surfaced — their silent-rejection failure modes... make
poor first-trade UX in chat"). The copilot's role here is upstream: it uses
MCP read tools to help pick *which* order to fill and reports the gate
result, but the fill itself is a direct SDK call from `execution/`.

**RFQ/Factory (`execution/src/prepareRfq.ts`) — use when no listed order
matches the strike/expiry you want.** This is the fully MCP-native write
path:

```
Claude calls prepare_request_rfq (MCP)     -- builds { chain, calls[] } envelope
  -> gate_coordinator.evaluate_thetanuts_trade()   -- pre-auction, delta unavailable -> moneyness proxy, advisory=true
  -> sign + send the envelope                -- Base MCP + Base Account (human click), or execution/src/prepareRfq.ts (scripted signer)
  -> ~60s: market makers submit encrypted offers
  -> decrypt + accept an offer (prepare_settle_rfq / early settlement)
  -> gate_coordinator.evaluate_thetanuts_trade() AGAIN, now with the real delta from the winning offer, before final settlement
  -> OptionFactory deploys the option contract, transfers collateral + premium atomically
```

The double gate-check on RFQ is deliberate: the first pass gates the
*request* (can't yet know the exact price/delta an MM will offer), the
second gates the *acceptance* once real terms exist. Nothing settles on the
first pass alone.

**Both paths share the same non-negotiables:**

- `chain_id` must resolve to `8453` (Base mainnet) at connection time — the
  execution scripts check `provider.getNetwork()` and abort otherwise, and
  `risk_checks.py` checks it again independently. Two places, not one, so a
  misconfigured RPC endpoint can't silently downgrade to testnet.
- A client-side hard USD cap (`MAX_NOTIONAL_USD_HARD_CAP` in `.env`)
  sits in front of the gate chain's own limit — belt-and-suspenders before
  anything reaches a signer, so a gate-chain misconfiguration alone can't
  authorize a large trade.
- The gate service being unreachable is treated as a `REJECT`, not skipped
  (`requireReadyForExecution` in `gateClient.ts` throws rather than
  proceeding) — fail-closed extends across the process boundary, not just
  within each gate function.
- The signer (`THETANUTS_PRIVATE_KEY`) exists in exactly one file family
  (`execution/src/*.ts`) and nowhere else — not in the gate chain, not in
  the MCP config, not in the copilot's context.
- Trade size defaults to 2 USDC (`execute:micro-trade`'s default arg) and
  is capped at 3 USDC across both the gate chain (`MAX_NOTIONAL_USD_PER_TRADE`)
  and the execution script's independent hard cap
  (`MAX_NOTIONAL_USD_HARD_CAP`) — straight from the workshop deck: "1-3 USDC
  covers you. A 1 USDC fill scores exactly the same as 100." There's no
  reason to size the demo trade any bigger.

**Before running for real:** the exact TypeScript field names used in
`executeMicroTrade.ts` (`order.metadata.asset`, `.delta`, strike decimal
scaling) are inferred from the SDK's prose documentation, not from reading
the published `.d.ts` files — `npm install` and check
`node_modules/@thetanuts-finance/thetanuts-client`'s actual types (or just
log a real order object) before the live run. Everything in `gate-chain/`
is unit-tested and verified; `execution/` is a verified-syntax skeleton that
needs one pass against the installed SDK's real types. Run
`npm run smoke-test` first either way — it's the official "30-second check"
(no wallet, no signer, no approvals) and proves the connection is live
before anything else is debugged.

## Official resources (per the workshop deck)

| | |
|---|---|
| Chain | Base mainnet, chainId 8453 |
| RPC | Free Alchemy or Infura key — not the public endpoint |
| SDK | `npm i @thetanuts-finance/thetanuts-client ethers` |
| CLI | `npm i -g @thetanuts-finance/cli` (binary `thetanuts`) |
| MCP | `npx -y @thetanuts-finance/mcp` |
| Tools | app.thetanuts.finance/tools |
| Docs | docs.thetanuts.finance/for-builders/sdk (source of truth — if the deck and the repo disagree, the repo wins) |
| Repo | github.com/Thetanuts-Finance/thetanuts-sdk |
| Help | Telegram `@ShawnSeanC`, Discord (Thetanuts chatroom, MUBA Hackathon server), GitHub issues on `thetanuts-sdk` |
| Live reference | odette.fi — production Thetanuts integration, explicitly "not a template, not something to copy for either track" |
