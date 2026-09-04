import { useEffect, useRef, useState } from "react";
import { converse, executeTrade } from "../api/client";
import type { ConverseResponse, GateSummary, PartialIntent, ProposeResponse } from "../types";
import ConversationMessage, {
  type ChatMessageData,
} from "./ConversationMessage";
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

export default function CopilotWorkspace({ onGateResult }: Props) {
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingIntent, setPendingIntent] = useState<PartialIntent | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setInput("");
    setError(null);
    setMessages((prev) => [
      ...prev,
      { role: "user", content: trimmed },
    ]);
    setLoading(true);

    let response: ConverseResponse;
    try {
      response = await converse(trimmed, pendingIntent);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      setError(msg);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "I couldn't reach the copilot service. Please try again.",
        },
      ]);
      setLoading(false);
      return;
    }
    setLoading(false);

    // Carry forward whatever slots (asset/optionType/spendUsdc) are still
    // known so the next message only needs to fill in what's missing --
    // otherwise each turn forgets everything said before it and the
    // clarification loop never terminates.
    setPendingIntent(response.status === "clarification_needed" ? response.partial_intent ?? null : null);

    if (response.actionable_data) {
      onGateResult?.({
        gateSummary: response.actionable_data.gate_summary,
        decision: response.actionable_data.decision,
      });
    }

    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: response.ai_explanation,
        converse: response,
        proposal: response.actionable_data ?? undefined,
      },
    ]);
  }

  async function handleExecute(proposal: ProposeResponse) {
    const intent = tradeIntentFromProposal(proposal);
    try {
      const result = await executeTrade(intent);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Executed ${intent.asset} ${intent.optionType.toUpperCase()} — ${result.txHash.slice(0, 10)}…`,
          executeResult: result,
        },
      ]);
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Execution failed for an unknown reason.";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Execution failed: ${msg}` },
      ]);
      throw e;
    }
  }

  function handleChip(s: string) {
    if (s === "Show screened orders") {
      setMessages((prev) => [
        ...prev,
        { role: "user", content: s },
        {
          role: "assistant",
          content:
            "Live screened book → right panel `Live Orders — Screened` (and bottom ticker). Each row is `GET /orders/screened` run through all 5 gates at $2 notional: green = `READY_FOR_EXECUTION`, red = `BLOCKED` + blocker. Click a trade chip to see the full `gate_summary` — unreachable gate = `BLOCKED` never silent pass (`gateClient.ts:requireReadyForExecution`).",
        },
      ]);
      return;
    }
    // One click → immediate send so judge sees READY/BLOCKED without a second click
    send(s);
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Sticky context header */}
      <CopilotHeader />

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-5 py-6">
          {messages.length === 0 && !loading && <EmptyState onPick={handleChip} />}

          <div className="space-y-5">
            {messages.map((m, i) => (
              <ConversationMessage key={i} message={m} onExecute={handleExecute} />
            ))}
          </div>

          {loading && (
            <div className="mt-5">
              <ThinkingIndicator />
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-lg border border-[var(--reject-border)] bg-[var(--reject-bg)]/40 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--reject)]" />
                <span className="text-[13px] text-[var(--reject)] font-medium">
                  API connection error
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {error} — check that the execution API is running on port 8790.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]/90 px-5 py-3">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              rows={1}
              placeholder="Describe a trade — e.g. “buy an ETH put with 2 dollars”…"
              className="field resize-none max-h-32 min-h-[42px] py-2.5"
            />
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || loading}
              className="btn btn-primary h-[42px]"
              aria-label="Send"
            >
              <SendIcon />
              Send
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-[var(--text-faint)]">
            Deterministic Shariah + risk gate chain · No LLM approves a trade ·
            Signing stays server-side
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Header ------------------------------ */
function CopilotHeader() {
  return (
    <div className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/80 px-5 py-3">
      <div className="mx-auto max-w-3xl flex items-center gap-2.5">
        <div className="h-2 w-2 rounded-full bg-[var(--pass)] shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
        <span className="text-[13px] font-semibold text-[var(--text-primary)]">
          AI Copilot
        </span>
      </div>
    </div>
  );
}

/* --------------------------- Empty state --------------------------- */
function EmptyState({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="py-10 text-center">
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-xl border border-[var(--accent-dim)] bg-[var(--accent-ink)] text-[var(--accent-strong)] text-2xl">
        ⚖
      </div>
      <h2 className="text-lg font-semibold text-[var(--text-primary)]">
        Thetanuts Shariah Risk Copilot
      </h2>
      <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-[var(--text-muted)]">
        Propose a Thetanuts options trade in plain language. It&apos;s resolved
        against live orders, run through the Shariah &amp; risk gate chain, and
        explained — before anything is executed.
      </p>

      {/* One-slide gate: 5 gates → READY/BLOCKED, unreachable = BLOCKED */}
      <div className="mx-auto mt-6 max-w-xl rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface-2)]/70 px-3 py-3">
        <div className="label mb-2.5 text-center text-[10px] tracking-[0.12em]">
          5 GATES → READY_FOR_EXECUTION · UNREACHABLE = BLOCKED
        </div>
        <div className="flex flex-wrap items-center justify-center gap-1">
          {["Screen", "Collateral", "Structure", "Delta", "Risk"].map((label, i) => (
            <span key={label} className="flex items-center gap-1">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-muted)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--text-faint)]" />
                {label}
              </span>
              {i < 4 && (
                <svg width="12" height="8" viewBox="0 0 12 8" fill="none" className="text-[var(--border-strong)]" aria-hidden>
                  <path d="M0 4h8M5 1l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
          ))}
          <svg width="12" height="8" viewBox="0 0 12 8" fill="none" className="mx-1 text-[var(--border-strong)]" aria-hidden>
            <path d="M0 4h8M5 1l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--pass-border)] bg-[var(--pass-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--pass)]">
            READY
          </span>
          <span className="text-[10px] text-[var(--text-faint)]">/</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--reject-border)] bg-[var(--reject-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--reject)]">
            BLOCKED
          </span>
        </div>
        <p className="mt-2 text-center text-[11px] leading-relaxed text-[var(--text-faint)]">
          <code className="num text-[11px] text-[var(--text-muted)]">gateClient.ts:requireReadyForExecution</code> fail-closed
        </p>
      </div>

      <div className="mx-auto mt-6 grid max-w-xl grid-cols-1 gap-2 sm:grid-cols-3">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => onPick(s)} className="chip">
            {s}
          </button>
        ))}
      </div>
      <p className="mx-auto mt-2 max-w-xl text-[11px] text-[var(--text-faint)]">
        Click a chip to run a live <code className="num">POST /propose</code> + <code className="num">gate_summary</code> demo — no second click.
      </p>
    </div>
  );
}

function SendIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}
