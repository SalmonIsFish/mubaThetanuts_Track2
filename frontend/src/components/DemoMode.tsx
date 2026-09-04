import { useEffect, useRef, useState } from "react";
import { converse, executeTrade } from "../api/client";
import type { ConverseResponse, GateSummary, PartialIntent, ProposeResponse } from "../types";
import MarketPrices from "./MarketPrices";
import OrdersPanel from "./OrdersPanel";
import GateChecklist from "./GateChecklist";
import TradeProposalCard from "./TradeProposalCard";
import ThinkingIndicator from "./ThinkingIndicator";
import { tradeIntentFromProposal } from "../lib/format";

const SUGGESTIONS = [
  "Buy ETH put with 2 dollars",
  "Buy AVAX call with 2 dollars",
  "Show screened orders",
];

interface Props {
  onGateResult?: (result: { gateSummary: GateSummary; decision: string }) => void;
}

export default function DemoMode({ onGateResult }: Props) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingIntent, setPendingIntent] = useState<PartialIntent | null>(null);
  const [result, setResult] = useState<ConverseResponse | null>(null);
  const [executeError, setExecuteError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [executing, setExecuting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    // DemoMode: "Show screened orders" is a desk hint, not a trade
    if (trimmed === "Show screened orders") {
      setResult({
        status: "clarification_needed",
        actionable_data: null,
        ai_explanation:
          "Live screened book → right column `Live Orders — Screened` (and bottom ticker). Each row is `GET /orders/screened` run through all 5 gates at $2 notional. Green = READY, red = BLOCKED. Click a trade chip to see the full `gate_summary`.",
        partial_intent: pendingIntent ?? null,
      } as ConverseResponse);
      setInput("");
      return;
    }

    setInput("");
    setError(null);
    setExecuteError(null);
    setConfirming(false);
    setLoading(true);

    let response: ConverseResponse;
    try {
      response = await converse(trimmed, pendingIntent);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      setError(msg);
      setLoading(false);
      return;
    }
    setLoading(false);
    setPendingIntent(response.status === "clarification_needed" ? response.partial_intent ?? null : null);

    if (response.actionable_data) {
      onGateResult?.({
        gateSummary: response.actionable_data.gate_summary,
        decision: response.actionable_data.decision,
      });
    }
    setResult(response);
  }

  async function handleExecute(proposal: ProposeResponse) {
    const intent = tradeIntentFromProposal(proposal);
    setExecuting(true);
    setExecuteError(null);
    try {
      await executeTrade(intent);
      setConfirming(false);
      setResult((prev) =>
        prev
          ? {
              ...prev,
              ai_explanation: `Executed ${intent.asset} ${intent.optionType.toUpperCase()} — check execution receipt below.`,
            }
          : prev,
      );
    } catch (e) {
      setExecuteError(e instanceof Error ? e.message : "Execution failed. Please try again.");
    } finally {
      setExecuting(false);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 3-column grid */}
      <div
        className="grid flex-1 min-h-0 gap-3 p-3"
        style={{ gridTemplateColumns: "240px 1fr 280px" }}
      >
        {/* Left — Live Market compact */}
        <div className="flex flex-col overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5" style={{ scrollbarWidth: "none" } as React.CSSProperties}>
          <MarketPrices />
          <div className="mt-auto pt-2 text-center text-[10px] text-[var(--text-faint)]">Supporting context</div>
        </div>

        {/* Center — Trade Workspace */}
        <div className="flex flex-col overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          {/* Suggestion chips row — larger, prominent */}
          <div className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-2)]/50 p-3">
            <div className="flex flex-wrap gap-2 justify-center">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2 text-[13px] font-medium text-[var(--text-primary)] hover:border-[var(--accent-dim)] hover:bg-[var(--accent-ink)]/40 hover:text-[var(--accent-strong)] transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Middle — result area (structured cards only, no bubbles) */}
          <div className="flex-1 overflow-y-auto p-4" style={{ scrollbarWidth: "none" } as React.CSSProperties}>
            {!result && !loading && !error && (
              <div className="flex h-full flex-col items-center justify-center py-8 text-center">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--accent-dim)] bg-[var(--accent-ink)] text-[var(--accent-strong)] text-xl">
                  ⚖
                </div>
                <p className="max-w-sm text-[13.5px] leading-relaxed text-[var(--text-muted)]">
                  Click a chip above or type a trade. Result appears here as structured cards — trade proposal, gate checklist, and AI explanation.
                </p>
                <p className="mt-2 text-[11px] text-[var(--text-faint)]">
                  Gate chain decides compliance — demo shows the visual result, not a chat transcript.
                </p>
              </div>
            )}

            {loading && (
              <div className="flex justify-center py-8">
                <ThinkingIndicator />
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-[var(--reject-border)] bg-[var(--reject-bg)]/40 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--reject)]" />
                  <span className="text-[13px] font-medium text-[var(--reject)]">API connection error</span>
                </div>
                <p className="mt-1 text-xs text-[var(--text-muted)]">{error}</p>
              </div>
            )}

            {result && (
              <div className="space-y-4">
                {result.status === "clarification_needed" && (
                  <div className="verdict-card verdict-clarify p-4">
                    <div className="label mb-2">Need More Information</div>
                    <p className="text-[13.5px] leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap">{result.ai_explanation}</p>
                  </div>
                )}

                {result.status === "rejected" && result.actionable_data && (
                  <div className="verdict-card verdict-rejected space-y-3 p-4">
                    <div className="flex items-center justify-between">
                      <span className="label">Blocked by Gate Chain</span>
                      <span className="rounded-full border border-[var(--reject-border)] bg-[var(--reject-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--reject)]">✕ Rejected</span>
                    </div>
                    <TradeProposalCard data={result.actionable_data} />
                    <GateChecklist gateSummary={result.actionable_data.gate_summary} blockers={result.actionable_data.blockers} decision={result.actionable_data.decision} />
                    <p className="text-[13.5px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap">{result.ai_explanation}</p>
                  </div>
                )}

                {result.status === "ready" && result.actionable_data && (
                  <div className="verdict-card verdict-ready space-y-3 p-4">
                    <div className="flex items-center justify-between">
                      <span className="label">Approved Proposal</span>
                      <span className="rounded-full border border-[var(--pass-border)] bg-[var(--pass-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--pass)]">✓ Ready for Execution</span>
                    </div>
                    <TradeProposalCard data={result.actionable_data} />
                    <GateChecklist gateSummary={result.actionable_data.gate_summary} blockers={result.actionable_data.blockers} decision={result.actionable_data.decision} />
                    <p className="text-[13.5px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap">{result.ai_explanation}</p>
                    {!confirming ? (
                      <button onClick={() => setConfirming(true)} className="btn btn-primary w-full">
                        Review &amp; Confirm
                      </button>
                    ) : (
                      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] p-3">
                        <p className="text-[12px] text-[var(--text-muted)] mb-2">This will sign on Base mainnet via the execution API (wallet is 0-balance for demo — expect insufficient funds, not a compliance bypass).</p>
                        {executeError && <div className="mb-2 text-[12px] text-[var(--reject)]">{executeError}</div>}
                        <div className="flex gap-2">
                          <button onClick={() => handleExecute(result.actionable_data!)} disabled={executing} className="btn btn-primary flex-1">
                            {executing ? "Executing…" : "Confirm & Execute"}
                          </button>
                          <button onClick={() => setConfirming(false)} disabled={executing} className="btn btn-ghost">
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {result.status === "clarification_needed" && !result.actionable_data && result.ai_explanation.includes("|") && (
                  <p className="text-[11px] text-[var(--text-faint)] text-center">Table rendered in structured card above — no scrolling needed for 16:9 recording.</p>
                )}
              </div>
            )}
          </div>

          {/* Bottom — composer */}
          <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-surface-2)]/40 p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKey}
                rows={1}
                placeholder="Describe a trade — e.g. “buy an ETH put with 2 dollars”…"
                className="field resize-none max-h-20 min-h-[42px] py-2.5 text-[13px]"
              />
              <button onClick={() => send(input)} disabled={!input.trim() || loading} className="btn btn-primary h-[42px]" aria-label="Send">
                Send
              </button>
            </div>
          </div>
        </div>

        {/* Right — Screened Orders compact */}
        <div className="flex flex-col overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5" style={{ scrollbarWidth: "none" } as React.CSSProperties}>
          <OrdersPanel />
          <div className="mt-auto pt-2 text-center text-[10px] text-[var(--text-faint)]">6/10 compliant sample</div>
        </div>
      </div>
    </div>
  );
}
