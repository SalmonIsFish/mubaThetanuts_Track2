# Physical Pitching Guide — Thetanuts Track

Based on organizer guidance for the in-person pitch. Time is limited — use
this to structure what you say and what goes on each slide.

---

## What Judges Want to Hear

Organizer list, paraphrased:

| Topic | What to cover | Where it lives in this project |
|---|---|---|
| **Product** | What is it, what does it do | AI copilot that recommends Thetanuts options, gated by Shariah + risk chain |
| **Benefits** | Why it matters, what problem it solves | On-chain options become usable for Shariah-compliant users — currently impossible |
| **Competitors** | Who else is doing this | No one — no protocol has an on-chain Shariah compliance layer for options |
| **Differentiator / USP** | What's uniquely yours | Deterministic gate chain (zero LLM in compliance), fail-closed, live on Base mainnet |
| **Target audience** | Who uses this | Crypto-native users who need Shariah screening, DeFi teams wanting compliance rails |
| **PMF** | Why now, why this fits | On-chain options growing, regulatory/compliance demand growing, zero current solutions |

---

## Slide Structure (7 slides max)

Keep text minimal. Judges can't read dense slides. Elaborate verbally.

### Slide 1: Title

- Project name: **AI Strategy & Shariah Risk Copilot — Thetanuts on Base**
- Team name
- Track 02: AI x Options
- One-line tagline: "An AI copilot that recommends on-chain options, gated by a
  deterministic Shariah compliance chain."

**Say this:** "We built an AI copilot for on-chain options that has a Shariah
compliance layer baked in — no other protocol has this."

### Slide 2: The Problem (2-3 bullets max)

- On-chain options (Thetanuts, Base) are growing, but Shariah-compliant users
  are completely locked out
- No protocol screens for Shariah compliance — existing copilots trade with
  zero compliance gates
- Users either break their principles or stay out of DeFi entirely

**Say this:** "If you need Shariah compliance, you can't use on-chain options
today. There's no screening layer anywhere. That's a real user base that's
currently locked out of an entire DeFi vertical."

### Slide 3: The Solution (2-3 bullets max)

- AI copilot that recommends Thetanuts option structures on Base mainnet
- 5-gate deterministic compliance chain runs before any transaction is signed
- No LLM ever makes the compliance call — pure functions, fully tested

**Say this:** "Our copilot connects to Thetanuts on Base, recommends options,
but every trade must pass five independent gates — underlying screening,
collateral source, option structure, delta band, and risk caps. If any gate
fails, the trade is blocked. The AI explains, it never decides."

### Slide 4: How It Works (architecture diagram, minimal text)

Use the diagram from `DEMO_VIDEO_GUIDE.md`:

```
User -> Execution (TS) -> Gate Chain (Python) -> Thetanuts SDK (Base)
              |                    |
         Signs ONLY if      5 gates, all must
     READY_FOR_EXECUTION    pass (fail-closed)
```

**Say this:** "Two services. The execution layer talks to Thetanuts — order
matching, pricing, Greeks. The gate chain is a separate process, pure Python,
no network calls, no LLM. Five independent gates, all must pass. The private
key is isolated — it only exists in the execution layer. If the gate chain is
unreachable, that's a hard block, not a skip."

### Slide 5: Why We're Different (USP — 2-3 bullets)

- **Zero LLM in compliance** — every gate is a deterministic pure function,
  not a prompt response
- **Fail-closed everywhere** — missing data = reject, unreachable gate =
  block, never a silent pass
- **Live on Base mainnet** — real SDK, real orders, real Greeks, not a mockup

**Say this:** "Every other AI trading tool on the market lets the LLM make
the decision. We don't. The LLM parses intent and explains results, but the
compliance call is always a pure function. That means it's auditable,
testable, and it doesn't hallucinate. And it's live — not a testnet demo,
not a mockup."

### Slide 6: Target Audience & Market Fit

- **Primary:** Crypto users who need Shariah compliance (no current option)
- **Secondary:** DeFi protocols, DAOs, and platforms that want to add
  compliance rails without building from scratch
- **Why now:** On-chain options volume growing, regulatory/compliance demand
  growing, zero existing solutions in this niche

**Say this:** "The target audience is anyone in crypto who needs Shariah
screening. That's a real, underserved user base. But the secondary play is
bigger — any DeFi protocol or DAO that wants compliance rails can use this
as infrastructure. We're not just a product, we're a compliance layer other
teams can build on."

### Slide 7: Demo & Next Steps

- "Demo video shows the full pipeline live on Base mainnet"
- "17/17 gate tests passing, live SDK connection, natural language copilot"
- Next: RFQ/write side, multi-collateral screening, real-time delta re-check

**Say this:** "Our video demo shows the full system running live — live
market data, live order matching, five gates passing or rejecting in real
time, and a natural language copilot that explains Shariah reasoning in
plain English. Next steps are the RFQ write side, more collateral types,
and real-time delta re-check before settlement."

---

## Verbal Tips

- **Don't read slides.** Slides have 2-3 bullets. You elaborate verbally.
- **Lead with the problem.** Judges need to feel the gap before they care
  about the solution.
- **Say "deterministic" and "fail-closed."** These are the words that signal
  you built something serious, not a chatbot wrapper.
- **Name the gap.** "Nobody else has a Shariah compliance layer for on-chain
  options." That's the entire pitch in one sentence.
- **Be honest about what's done vs. what's next.** The live pipeline is
  proven. The RFQ write side and multi-collateral screening are roadmap.
  Judges respect honesty over overclaiming.
- **If they ask "does it work?"** — "Yes, live on Base mainnet. 17 out of 17
  gate tests, live SDK connection, full pipeline dry-run against real maker
  orders. The video shows it."
- **If they ask "are the options load-bearing?"** — "Yes. Stub out the
  Thetanuts calls and the system stops working. Every gate input comes from
  live `fetchOrders` and `calculate_collateral_required` calls."
- **If they ask "who's the user?"** — "Crypto users who need Shariah
  screening have nowhere to trade options on-chain today. That's a real
  gap, not a hypothetical."

---

## Slide Design Notes

- **Font:** Clean sans-serif (Inter, Helvetica, or similar)
- **Colors:** Dark background, high-contrast text. Match Base/thethanuts
  branding if you want, but don't overthink it.
- **No walls of text.** 2-3 bullets per slide, max 10 words per bullet.
  Everything else is what you say out loud.
- **Diagram slide:** The architecture diagram is the most important visual.
  Make it big, make it clean.
- **One slide = one idea.** If you're explaining two things, that's two slides.

---

## PowerPoint Generation Prompt

Copy the prompt below and paste it to Claude to generate the slides:

---

```
Create a PowerPoint presentation for a hackathon pitch. The project is an
AI Strategy & Shariah Risk Copilot for Thetanuts on Base mainnet, submitted
to Muba Hacks 2026, Track 02 (AI x Options).

SLIDES TO CREATE (7 total, minimal text, dark theme):

Slide 1 — Title:
- "AI Strategy & Shariah Risk Copilot"
- "Thetanuts on Base Mainnet"
- "Muba Hacks 2026 — Track 02: AI x Options"
- Tagline: "An AI copilot that recommends on-chain options, gated by a deterministic Shariah compliance chain."

Slide 2 — The Problem:
- On-chain options are growing but Shariah-compliant users are locked out
- No protocol has a Shariah screening layer for options
- Existing AI copilots trade with zero compliance gates
- Keep bullets short, 8-10 words each

Slide 3 — The Solution:
- AI copilot recommends Thetanuts option structures on Base mainnet
- 5-gate deterministic compliance chain runs before any transaction is signed
- No LLM ever makes the compliance call — pure functions, fully tested

Slide 4 — How It Works (architecture diagram):
- Show this flow: User → Execution Layer (TypeScript) → Gate Chain (Python, 5 gates) → Thetanuts SDK (Base Mainnet)
- Execution layer handles order matching and signing
- Gate chain is separate, deterministic, fail-closed
- Private key isolated in execution layer only

Slide 5 — Why We're Different:
- Zero LLM in compliance — every gate is a deterministic pure function
- Fail-closed everywhere — missing data = reject, unreachable gate = block
- Live on Base mainnet — real SDK, real orders, real Greeks, not a mockup

Slide 6 — Target Audience & Market Fit:
- Primary: Crypto users who need Shariah compliance (currently no option)
- Secondary: DeFi protocols and DAOs wanting compliance rails
- Why now: Options volume growing, compliance demand growing, zero existing solutions

Slide 7 — Demo & Next Steps:
- Full pipeline live on Base mainnet (show in video demo)
- 17/17 gate tests passing, live SDK connection, natural language copilot
- Next: RFQ/write side, multi-collateral screening, real-time delta re-check

DESIGN:
- Dark background (dark gray or near-black), white/light text
- Clean sans-serif font (Inter or Helvetica)
- 2-3 bullets per slide, max 10 words per bullet
- Architecture diagram slide should be visual and large
- No walls of text — the presenter elaborates verbally
- Use accent color sparingly (teal or green for "pass" states, red for "blocked")
```
