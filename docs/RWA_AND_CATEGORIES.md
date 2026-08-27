# RWA & Asset Category Taxonomy

Note-to-self doc, written so this doesn't get lost between now and the demo.

## RWA has two unrelated meanings -- use the right one

| | Real-World Assets | Risk-Weighted Assets |
|---|---|---|
| Field | Blockchain / DeFi | Banking regulation (Basel III) |
| What it means | Tokens that represent a claim on something off-chain: a Treasury bill, gold, a rental property, a company | A bank's assets multiplied by a regulator-assigned risk weight, used to size minimum capital requirements |
| Relevant here? | **Yes** -- this is the one that matters for "what can Thetanuts write an option on" | No -- this is a banking-capital-adequacy concept, unrelated to an options protocol or to this gate chain |

**This repo only ever means the first one.** If "RWA" comes up in a workshop conversation and someone's talking about capital ratios, that's the other RWA -- not what we're building.

## Reality check before anything else

As of the builder docs (2026-08-27), Thetanuts' supported underlyings are
crypto-native: BTC, ETH, SOL (per `get_market_data` / the SDK's supported
assets). **There is no RWA underlying listed on Thetanuts today.** Everything
below is forward-looking architecture -- the gate chain is built to screen an
RWA underlying correctly *if and when* one gets listed (on Thetanuts or a
protocol you pair with it), not a claim that you can trade one right now.
Don't say "we support RWA options" in the demo; say "the compliance layer is
already built to handle RWA underlyings the moment one's listed" -- that's
true and it's a stronger technical flex anyway.

## Category taxonomy

`data/crypto-underlying-universe.json` now tags every record with a
`category`. `gate-chain/underlying_screen.py` routes on it:

| Category | Examples in the dataset | How it's screened |
|---|---|---|
| `crypto_native` | BTC, ETH, SOL, WETH, cbBTC | Dataset-driven PASS/REJECT, same as before -- non-interest-bearing network assets |
| `stablecoin` | USDC | `COMPLIANT_CONDITIONAL`, collateral-only, conditional on never touching a lending/yield venue (enforced by `collateral_gate.py`) |
| `rwa_debt` | BUIDL, OUSG, USDY | **Hard-rejected in code** (`HARD_REJECT_CATEGORIES` in `underlying_screen.py`), not just in the dataset -- see below |
| `rwa_commodity` | PAXG | `COMPLIANT_CONDITIONAL`, flagged `requires_scholar_review_on_qabd` |
| `rwa_real_estate` | illustrative example only | `COMPLIANT_CONDITIONAL`, per-issuer review required |
| `rwa_equity` | illustrative example only | Defaults `REJECT` until the specific issuer clears the same screen the equity project already runs |

**Why `rwa_debt` is hard-coded, not just data-driven:** every other category
gets its verdict from the JSON file, which means a rushed edit under
deadline pressure could flip a record to `COMPLIANT` by mistake. Tokenized
Treasuries and private credit pay interest *by construction* -- there's no
version of BUIDL or OUSG that isn't Riba al-Nasiyah, so this one category
gets a code-level guard that a data edit alone can't override. See
`underlying_screen.py::check_token()`.

## Worked RWA examples

**BlackRock BUIDL, Ondo OUSG, Ondo USDY** -- tokenized US Treasuries / a
Treasury fund. The yield paid to holders is interest, full stop. This is
the single biggest RWA category by TVL in DeFi right now, and it's also the
most unambiguously non-compliant one -- good example to have ready if
someone asks "so RWA is Shariah-friendly, right?" No: most of the RWA market
today is tokenized debt, which is exactly the instrument Riba.md rules out.

**Paxos Gold (PAXG)** -- each token is fully backed by one allocated troy
ounce of physical gold, redeemable for delivery, no yield. No Riba concern.
The open question is *qabd* (possession): gold is a classical "ribawi" item,
and there's a live scholarly debate over whether an on-chain, redeemable,
audited claim satisfies the hand-to-hand possession classical fiqh requires
for gold-for-currency exchange. Marked `COMPLIANT_CONDITIONAL` pending
review, not an automatic pass -- this is the right level of caution for a
gate chain that fails closed everywhere else.

**Fractional real estate (RealT-style, illustrative)** -- return comes from
rent, which is usufruct/Ijarah, not interest. Structurally closer to
permissible than tokenized debt, but conditional on the property itself not
being financed with an interest-bearing mortgage, and on the underlying
SPV/business clearing the same screen an equity would.

**Tokenized equity (illustrative)** -- a tokenized-stock wrapper is only as
compliant as the company underneath it. This routes through the *same*
business-activity + debt-ratio screen the equity side of the project
already has in `sec_edgar_screen.py` -- it isn't a new category of rule, RWA
equity is just "equity screening, wrapped." Defaults to REJECT per-symbol
until that screen actually runs on a named issuer, matching the fail-closed
pattern everywhere else in this file.

## How this integrates with the rest of the gate chain

Nothing downstream had to change. `collateral_gate.py` and
`option_structure_gate.py` only care about a token symbol passing
`underlying_screen.check_token()` -- they don't know or care whether that
symbol resolved via the `crypto_native` path or the `rwa_commodity` path.
`gate_coordinator.py`'s `gate_summary.underlying_screen` result now carries
a `category` field, so a demo or a judge can see *which* taxonomy bucket a
trade's underlying fell into without digging into the dataset file.

## Other categories worth having on the radar (not yet in the dataset)

You asked for more examples beyond RWA -- these are the ones I'd flag as
worth a category before they show up in a real trade and get waved through
by accident:

- **Liquid staking derivatives** (stETH, rETH, cbETH-with-yield, etc.) --
  already called out as excluded in the ETH/SOL record rationale, but
  doesn't have its own category yet. Worth adding `liquid_staking_derivative`
  as an explicit hard-reject-by-default category (same pattern as
  `rwa_debt`) rather than relying on someone remembering the caveat in a
  comment.
- **Perpetual/leverage tokens** and anything with embedded funding-rate
  payments -- funding payments are economically close to interest in a lot
  of structures; would need its own review, not an assumption either way.
- **Governance/utility tokens of DeFi protocols themselves** (e.g. a
  lending-protocol's own governance token) -- the token itself might be
  fine, but if the protocol's core business is interest-based lending,
  there's a "impermissible primary business" argument parallel to the
  equity screen's business-activity test. Same shape of question as
  screening a bank's stock.

None of these are urgent for the hackathon demo -- BTC/ETH/SOL vanilla
options already exercise the full gate chain end to end. Listed here so
they're written down before they're needed, not so they all get built this
week.
