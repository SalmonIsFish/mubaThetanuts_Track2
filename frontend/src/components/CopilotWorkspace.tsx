import { useEffect, useRef, useState } from "react";
import { converse, executeTrade } from "../api/client";
import type { ConverseResponse, ProposeResponse } from "../types";
import ConversationMessage, {
  type ChatMessageData,
} from "./ConversationMessage";
import ThinkingIndicator from "./ThinkingIndicator";
import { tradeIntentFromProposal } from "../lib/format";

const SUGGESTIONS = [
  "Buy an ETH put with 2 dollars",
  "Get me a BTC call for $3",
  "Propose a SOL put spending $1",
  "Ask about an options spread",
];

export default function CopilotWorkspace() {
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      response = await converse(trimmed);
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
  }

  function onSuggestion(s: string) {
    setInput(s);
    inputRef.current?.focus();
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Terminal product band */}
      <WorkspaceBand />

      <div ref={scrollRef} className="workspace-bg flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-5 py-6">
          {messages.length === 0 && !loading && <EmptyState onPick={onSuggestion} />}

          <div className="space-y-6">
            {messages.map((m, i) => (
              <ConversationMessage key={i} message={m} onExecute={handleExecute} />
            ))}
          </div>

          {loading && (
            <div className="mt-6">
              <ThinkingIndicator />
            </div>
          )}

          {error && (
            <div className="mt-5 rounded-lg border border-[var(--reject-border)] bg-[var(--reject-bg)]/40 px-4 py-3.5">
              <div className="flex items-center gap-2">
                <span aria-hidden className="text-[var(--reject)]">✕</span>
                <span className="text-[13px] text-[var(--reject)] font-medium">
                  Copilot unavailable
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
                We couldn&apos;t reach the evaluation service. Please try again in a
                moment — your request was not processed.
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
              Evaluate
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

/* --------------------------- Workspace band ------------------------ */
function WorkspaceBand() {
  return (
    <div className="band flex shrink-0 items-center justify-between px-5 py-2.5">
      <div className="flex items-center gap-2.5">
        <span className="label">AI Copilot</span>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
          <span aria-hidden>·</span> Initiate &amp; evaluate a trade
        </span>
      </div>
      <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
        <span className="lamp lamp-pass" aria-hidden />
        Deterministic gate chain
      </span>
    </div>
  );
}

/* --------------------------- Empty state --------------------------- */
function EmptyState({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="ops-panel">
      {/* System context strip */}
      <div className="ops-head flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="label">SHARIAH RISK COPILOT</span>
        </div>
        <div className="flex items-center gap-4">
          <Sys ctx="Market" val="LIVE" />
          <Sys ctx="Risk Engine" val="DETERMINISTIC" />
          <Sys ctx="Gate Chain" val="FAIL-CLOSED" />
        </div>
      </div>

      <div className="px-5 py-6">
        <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
          What would you like to trade?
        </h2>
        <p className="mt-1.5 max-w-lg text-[13px] leading-relaxed text-[var(--text-muted)]">
          Describe the option you want. The copilot resolves it against live
          orders, runs the deterministic Shariah &amp; risk gate chain, and
          explains the result — nothing is executed until you confirm.
        </p>

        <div className="mt-5 grid max-w-3xl grid-cols-1 gap-2 sm:grid-cols-2">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => onPick(s)} className="chip">
              {s}
            </button>
          ))}
        </div>

        <div className="mt-6 ops-grid">
          <div className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
            <span className="text-[var(--pass)]" aria-hidden>✓</span>
            Underlying screen
          </div>
          <div className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
            <span className="text-[var(--pass)]" aria-hidden>✓</span>
            Collateral &amp; structure
          </div>
          <div className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
            <span className="text-[var(--pass)]" aria-hidden>✓</span>
            Delta band
          </div>
          <div className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
            <span className="text-[var(--pass)]" aria-hidden>✓</span>
            Risk / notional caps
          </div>
        </div>
      </div>
    </div>
  );
}

function Sys({ ctx, val }: { ctx: string; val: string }) {
  return (
    <span className="sys-ind">
      <span className="lamp lamp-pass" aria-hidden />
      <span>{ctx}</span>
      <span className="val num">{val}</span>
    </span>
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
