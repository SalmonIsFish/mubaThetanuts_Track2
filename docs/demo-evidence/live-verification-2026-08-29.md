# Live verification — 2026-08-29 14:31 UTC

Captured while wiring up the demo wallet. No live trade has been broadcast — the
wallet (`0x2422C392C2Aa88acc44B7c1248bF3CffD6800bb6`) is deliberately unfunded
(see "Status" below for why). Everything below this line, up to `/execute`
itself, is real and live: real Base mainnet RPC, a real currently-open maker
order, real Thetanuts pricing/Greeks, and a real pass through every gate-chain
rule. Nothing here is mocked, stubbed, or replayed from a fixture.

## Status

Per organizer clarification in the hackathon Discord (Shawn, 2026-08-29):
placing a real trade is optional — "if you don't want to use it, that's also
fine, you can explain your ideas and don't need to run the demo on it." This
submission takes the honest middle path: the full pipeline is proven against
live mainnet data end-to-end, stopping one signature short of broadcasting,
rather than either faking a trade or hiding how close it got.

## 1. Gate chain — 17/17 tests passing

```
platform win32 -- Python 3.14.3, pytest-9.1.1
collected 17 items

tests/test_gate_coordinator.py::test_compliant_buy_put_passes_all_gates PASSED
tests/test_gate_coordinator.py::test_unknown_underlying_rejected PASSED
tests/test_gate_coordinator.py::test_insufficient_collateral_rejected PASSED
tests/test_gate_coordinator.py::test_borrowed_collateral_rejected PASSED
tests/test_gate_coordinator.py::test_iron_condor_rejected_by_default PASSED
tests/test_gate_coordinator.py::test_naked_call_write_rejected_without_underlying_balance PASSED
tests/test_gate_coordinator.py::test_covered_call_write_passes_with_underlying_balance PASSED
tests/test_gate_coordinator.py::test_deep_otm_delta_rejected PASSED
tests/test_gate_coordinator.py::test_over_notional_cap_rejected PASSED
tests/test_gate_coordinator.py::test_non_mainnet_chain_rejected PASSED
tests/test_gate_coordinator.py::test_rfq_pregate_uses_moneyness_proxy_and_flags_recheck PASSED
tests/test_underlying_screen.py::test_crypto_native_still_passes PASSED
tests/test_underlying_screen.py::test_rwa_debt_hard_rejected PASSED
tests/test_underlying_screen.py::test_rwa_debt_is_the_only_hard_reject_category_by_default PASSED
tests/test_underlying_screen.py::test_rwa_commodity_passes_conditionally_with_restrictions_surfaced PASSED
tests/test_underlying_screen.py::test_rwa_equity_illustrative_record_rejected_pending_issuer_review PASSED
tests/test_underlying_screen.py::test_unknown_symbol_still_fails_closed PASSED

17 passed in 0.15s
```

## 2. Execution layer — live connection smoke test

`npm run smoke-test` (no wallet, no signer, no approvals — the SDK's own
"30-second check"):

```
329 live orders
{
  prices: {
    ETH: 2436.43,
    BTC: 77703.16,
    SOL: 104.28922791,
    XRP: 1.3881,
    BNB: 689.12675562,
    AVAX: 7.318
  },
  metadata: { lastUpdated: 1788013918000, currentTime: 1788013922336 }
}

Connected to live Base mainnet Thetanuts data. Safe to proceed.
```

## 3. Full pipeline dry-run — `POST /execution/propose`

Request:
```json
{"asset":"ETH","optionType":"put","side":"BUY","spendUsdc":2}
```

This resolved against a real, currently-open OptionBook maker order (maker
`0xEcda1D002FBC55F2Fd3386bB4B9B95F859f3C39E`, ETH vanilla put, strike
$2,420, live spot $2,436.43, live delta -0.2662 from the order's own
`rawApiData.greeks`), ran it through every gate-chain rule against that live
data, and returned:

```
decision:  READY_FOR_EXECUTION
blockers:  []

underlying_screen  PASS  ETH / crypto_native / token_compliant
collateral_gate    PASS  2 USDC posted, 2 USDC required, fully self-funded (no borrowing)
option_structure   PASS  VANILLA_PUT, fully_paid_long_position
delta_gate         PASS  |delta| = 0.2662 (band: 0.10-0.90)
risk_checks        PASS  mainnet confirmed, under $3/trade and $10/day caps

2 USDC -> 0.3011 contracts @ this order's live price
```

Full raw response saved for reference: nothing in this response is synthetic
— `numContracts`, `price`, `strikes`, and the Greeks all came back from the
live OptionBook indexer and the live pricing engine at request time.

## 4. Rejection scenarios — the gate chain live-blocking real attempts

Runnable script: `docs/demo-evidence/rejection-scenarios.sh`. Each hits the
live `gate-chain/server.py` process directly (port 8787) — same code path
as every approved trade above, just fed a trade attempt designed to fail one
specific gate. Captured 2026-08-29 14:44 UTC:

**Riba — BUIDL (BlackRock's tokenized Treasury fund, a real, well-known
institutional product):**
```
decision: BLOCKED
blockers: ["underlying_rejected"]
underlying_screen: REJECT — category_structurally_non_compliant (rwa_debt)
```
Everything else about the request passes (collateral, structure, delta,
risk) — it's rejected purely because the yield is interest by construction,
and `rwa_debt` is hard-rejected in code, not just data.

**Riba via borrowed collateral — numerically fully funded, source flagged
as borrowed:**
```
decision: BLOCKED
blockers: ["collateral_rejected", "structure_rejected"]
collateral_gate: REJECT — borrowed_collateral_not_permitted
option_structure_gate: REJECT — leveraged_writing_not_permitted
```
2 USDC posted against 2 USDC required — the numbers match. Rejected anyway
because the gate checks the *source* of the collateral, not just whether it
balances.

**Maysir — deep out-of-the-money "lottery ticket" (delta -0.03):**
```
decision: BLOCKED
blockers: ["delta_rejected"]
delta_gate: REJECT — delta_below_minimum_too_far_otm (band: 0.10-0.90)
```

**Risk control — 50 USD notional against the 3 USD per-trade cap:**
```
decision: BLOCKED
blockers: ["risk_rejected"]
risk_checks: REJECT — per_trade_notional_cap: false, daily_notional_cap: false
```
Fully compliant otherwise (real underlying, real collateral, healthy delta)
— rejected purely on size.

## 5. The AI conversation layer — `POST /converse`, live, three scenarios

This is the part the track is named after made visible: natural language in,
a gate-checked decision + plain-language explanation out. Implementation:
`execution/src/copilot.ts` (intent parsing + explanation, via OpenRouter,
`openai/gpt-4o-mini`) wired into `execution/src/api/server.ts`'s `/converse`
route. Deliberately propose-only — this route calls the exact same read-only
path `/propose` uses (`resolveTradeIntent` → `buildGateRequest` →
`evaluateTrade`) and can never reach `/execute`; the LLM parses and explains,
it never signs. Every LLM response is re-validated locally (Zod schema, plus
the same `parseTradeBody` hard-cap check `/propose`/`/execute` use) before
anything reaches the gate chain — the LLM's output is treated as untrusted
input, not a pre-cleared request. Captured 2026-08-29 (UTC), immediately
after wiring in a real OpenRouter key:

**Scenario 1 — clear, supported request: `"buy an eth put with 2 dollars"`**
```
status: ready
```
Parsed correctly, resolved against a real live order (strike $2,440, spot
$2,443.05, delta -0.4506), all five gates passed. AI explanation:
> "The compliance/risk gate has determined that your trade is READY FOR
> EXECUTION. All checks have passed, confirming that the asset (ETH) and
> collateral (USDC) are compliant, and the option structure is properly set
> up. You can proceed with your trade without any issues."

**Update — same scenario, re-run after grounding `explainDecision()` in the
dataset's own fiqh rationale** (see `execution/src/copilot.ts` — it now looks
up the traded asset's and collateral token's actual reviewed rationale from
`data/crypto-underlying-universe.json`, the same file `underlying_screen.py`
itself screens against, and hands that text to the LLM instead of only the
bare gate_summary status fields):
> "The trade involving a put option on Ether (ETH) has been approved and is
> ready for execution. The underlying asset, ETH, is compliant because it is
> a native network asset used for transactions and not a debt instrument,
> which aligns with Shariah principles. The collateral used, USD Coin (USDC),
> is also compliant under specific conditions; it must only be used for cash
> collateral and settlement, and not for lending or earning interest. All
> checks have passed, ensuring the trade adheres to the necessary Shariah
> guidelines."

This is the difference between the copilot describing a JSON object and the
copilot explaining actual Islamic finance reasoning — the "native asset, not
a debt instrument" and "settlement-only, never lending" language comes
directly from the dataset's reviewed rationale, not the LLM's own general
knowledge. Zero changes to gate-chain itself; this only enriches the
explanation layer.

**Scenario 2 — unsupported request: `"Swap $100 USDC for BUIDL"`**
```
status: clarification_needed
actionable_data: null
```
Notably: BUIDL is the same non-compliant tokenized Treasury fund from
scenario 1 in section 4 above. This request never even reached the gate
chain — the copilot correctly recognized a token swap isn't a shape this
system trades at all (it only buys vanilla puts/calls), and asked for
clarification rather than misinterpreting it into some other action.

**Scenario 3 — over the hard cap: `"buy a btc call, spend 50 dollars"`**
```
status: clarification_needed
ai_explanation: "spendUsdc $50 exceeds the client-side hard cap $3."
```
The LLM parsed this correctly (BTC, call, $50) — the request was stopped by
the same deterministic client-side hard-cap check `/propose` and `/execute`
enforce, *before* the gate chain was even called. This response bypasses the
LLM's explanation step entirely by design: a hard dollar cap doesn't need an
AI to explain it, and this is a clean demonstration that the cap holds
regardless of what the AI extracts from a natural-language request.

## What's left for an actual broadcast

Exactly one step: fund `0x2422C392C2Aa88acc44B7c1248bF3CffD6800bb6` on Base
mainnet with ~3 USDC + a few cents of ETH for gas, then run
`npm run execute:micro-trade -- ETH put 2000000` from `execution/`. The code
path, the gate check, and the order match are already proven above — funding
is the only gap between this evidence and a signed transaction.
