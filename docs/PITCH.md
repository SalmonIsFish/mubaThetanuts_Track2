# Pitch — AI Strategy & Shariah Risk Copilot for Thetanuts

**Track 02: AI × Options.**

## The idea, in two sentences

On-chain options are structurally unusable today by anyone who needs Shariah
compliance — no protocol has that layer, so that entire user base is locked
out. This adds it: an AI copilot that recommends Thetanuts option structures
on Base, gated by a deterministic Shariah + risk chain that runs before any
transaction is signed — no LLM ever makes the compliance call.

## Does it work?

Yes, end-to-end against live Base mainnet data — with one honest gap. The
full pipeline is real and verified, not mocked:

- **Gate chain**: 5 independent, fail-closed gates (Shariah screen,
  collateral, option structure, delta band, risk caps) — 17/17 unit tests
  passing, zero LLM in this path.
- **Live connection**: verified against real Base mainnet Thetanuts data
  (330 live orders, live prices across ETH/BTC/SOL/XRP/BNB/AVAX).
- **Full pipeline dry-run**: a real trade intent (2 USDC, ETH put) resolved
  against a real, currently-open maker order, ran through every gate against
  that order's live Greeks and pricing, and returned `READY_FOR_EXECUTION`
  with zero blockers.
- **HTTP API**: four routes wired for a frontend (`/orders`, `/market-data`,
  `/propose`, `/execute`) — reads and gate-checks need no wallet at all.

The one thing not done: the final signed broadcast. The demo wallet is
funded with $0 by choice, not by failure — per the organizer's own Discord
clarification, a live broadcast is optional, and this build takes the honest
middle path rather than faking one. Full raw evidence (test output, smoke
test, the live `/propose` response) is in `docs/demo-evidence/`.

## Are the options load-bearing?

Yes — stub out the Thetanuts calls and this doesn't just look different, it
stops working entirely. The gate chain's own numbers (collateral required,
matched order, price, delta) come from live `fetchOrders`/
`calculate_collateral_required` calls, not fixtures. `tradeResolver.ts` is
the single source of truth feeding both the CLI script and the HTTP API, so
there's no separate "demo path" running on canned data.

## Would anyone actually use it?

Nobody else at this hackathon will have a compliance layer, and there's a
real, currently-locked-out user base behind it. This isn't a business plan —
it's a couple of honest sentences: crypto users who need Shariah screening
have nowhere to trade options on-chain today, because no protocol screens
for it. This genuinely extends work started before the hackathon.
