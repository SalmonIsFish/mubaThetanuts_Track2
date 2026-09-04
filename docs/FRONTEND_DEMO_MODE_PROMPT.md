# Frontend Demo Mode — Prompt for Claude

Copy the prompt below and paste it to the other terminal to build the demo
mode view.

---

```
Build a "Demo Mode" view for the Thetanuts Shariah Risk Copilot frontend.
This is a dedicated layout designed specifically for video recording /
presentation — everything visible in one screen without scrolling, optimized
for a 16:9 screen recording.

## Current Architecture

The frontend is at `/mnt/e/Github2/mubaThetanuts_Track2/frontend/`. It's a
Vite + React + TypeScript + Tailwind app. The main entry is `AppShell.tsx`.

Key existing components:
- `GateSpine.tsx` — top bar showing 5 gates as a pipeline (idle/pass/reject)
- `CopilotWorkspace.tsx` — the chat interface with suggestion chips
- `MarketPrices.tsx` — right panel live prices (ETH, BTC, SOL, AVAX, XRP, BNB)
- `OrdersPanel.tsx` — right panel screened orders with green/red dots
- `ComplianceTicker.tsx` — bottom scrolling marquee of screened orders
- `GateChecklist.tsx` — detailed per-gate breakdown (shows when trade resolves)
- `TradeProposalCard.tsx` — trade details card (spot, contracts, collateral, delta)
- `ConversationMessage.tsx` — renders chat messages with structured cards

The API client is at `src/api/client.ts`. Types are at `src/types/index.ts`.

## What to Build

Add a `DemoMode` component that can be toggled from the existing side rail
(next to the "Copilot" button, add a "Demo" button). When active, it replaces
the main area with a single-screen dashboard layout.

### Layout (single screen, no scrolling):

```
+------------------------------------------------------------------+
|  GATE SPINE — full width, larger text, bold colors               |
|  Screen → Collateral → Structure → Delta → Risk → READY/BLOCKED  |
+------------------------------------------------------------------+
|                 |                            |                    |
|  LIVE MARKET   |    TRADE WORKSPACE         |  SCREENED ORDERS   |
|  (compact)     |    (center)                |  (compact)         |
|                |                            |                    |
|  ETH  $2,478   |  [Suggestion Chips Row]    |  ETH $2,420 PUT    |
|  BTC  $80,390  |                            |  ● PASS            |
|  SOL  $107.29  |  [Chat / Result Area]      |  ETH $2,440 PUT    |
|  AVAX $7.32    |  - Trade proposal card     |  ● PASS            |
|  XRP  $1.39    |  - Gate checklist          |  BTC $84,000 CALL  |
|  BNB  $689.13  |  - AI explanation          |  ● BLOCKED (delta) |
|                |                            |  ...               |
|  BASE · 8453   |  [Composer Input]          |  6/10 compliant    |
|                |                            |                    |
+------------------------------------------------------------------+
|  COMPLIANCE TICKER — full width scrolling marquee                 |
+------------------------------------------------------------------+
```

### Requirements:

1. **Gate Spine (top, full width):**
   - Same `GateSpine` component but rendered larger (bigger text, more padding)
   - When all 5 gates pass, add a brief CSS pulse/glow animation on the
     "Cleared" text (green glow, 2-3 seconds, then settles)
   - When blocked, the "Blocked" text should be red and bold

2. **Left column — Live Market (compact):**
   - Reuse `MarketPrices` but in a more compact vertical layout
   - Show all 6 assets with prices, the "BASE · 8453" badge
   - Smaller font, tighter spacing — this is supporting context, not the focus

3. **Center column — Trade Workspace:**
   - Top: a horizontal row of suggestion chips (same 3 from `CopilotWorkspace`:
     "Buy ETH put with 2 dollars", "Buy AVAX call with 2 dollars",
     "Show screened orders") — larger, more prominent, easy to click on camera
   - Middle: when a chip is clicked or text is typed, show the result here:
     - For approved trades: the `TradeProposalCard` + `GateChecklist` stacked
       vertically, with the AI explanation text below
     - For blocked trades: the `GateChecklist` with red failing gates highlighted
     - For clarification: the clarification message
   - The chat message bubbles are hidden in demo mode — only show the
     structured result cards (trade card, gate checklist, explanation)
   - Bottom: the composer input (textarea + send button) — same as current

4. **Right column — Screened Orders (compact):**
   - Reuse `OrdersPanel` but more compact
   - Show the order list with green/red dots, compliant count
   - Tighter spacing, smaller font

5. **Bottom — Compliance Ticker (full width):**
   - Same `ComplianceTicker` component, full width

6. **Visual polish:**
   - Use CSS Grid for the 3-column layout: `grid-template-columns: 240px 1fr 280px`
   - All columns should have `overflow-y: auto` with hidden scrollbars
     (`scrollbar-width: none`) so the content is accessible but the page
     doesn't look like it scrolls
   - The center column should be the tallest — it's the focus
   - Add a subtle background gradient or border between columns for visual
     separation
   - Gate checklist rows should animate in with a staggered delay (100ms per
     row) using CSS keyframes — the existing `gate-row-reveal` class in
     `GateChecklist.tsx` already has `--i` index, use it for `animation-delay`

7. **Interaction:**
   - Clicking a suggestion chip sends the request through the same
     `converse()` API call as the current copilot
   - The result appears in the center column as structured cards
   - The gate spine at the top updates in real time
   - The "Review & Confirm" button still works (but execution is secondary —
     the visual result is the point)

8. **State:**
   - Add a `demoMode` boolean to `AppShell.tsx`
   - When `demoMode` is true, render `<DemoMode />` instead of
     `<CopilotWorkspace />` in the main area
   - The side rail gets a new button: icon "📊", label "Demo"
   - The right desk panel and bottom ticker remain visible in both modes

### Style notes:
- Dark background, same CSS variables as existing theme
- Font sizes: gate spine labels 13px, market prices 12px, trade card 14px,
  gate checklist 12px, ticker 11px
- The center column should feel like the "main event" — slightly elevated
  background or subtle border glow when a result is showing
- Green = `var(--pass)`, Red = `var(--reject)`, idle = `var(--text-faint)`
- Keep all existing components and just compose them in a new layout —
  don't modify the existing components' internals

### Files to create/modify:
- Create: `src/components/DemoMode.tsx` — the new layout component
- Modify: `src/components/AppShell.tsx` — add demo mode toggle to side rail
- Create: `src/components/DemoMode.css` (or use Tailwind) — animations and
  grid layout styles

### Testing:
- Run `npm run dev` and verify the demo mode renders correctly
- Click each suggestion chip and verify the result appears in the center
- Verify the gate spine animates on pass/block
- Verify the screened orders panel shows live data
- Verify the ticker scrolls at the bottom
- Test at 1920x1080 resolution (standard screen recording size)
```
