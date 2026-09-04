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
      {/* Sticky context header */}
      <CopilotHeader />

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-5 py-6">
          {messages.length === 0 && !loading && <EmptyState onPick={onSuggestion} />}

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
                <StatusGlyph />
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
      <div className="mx-auto max-w-3xl flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-2 w-2 rounded-full bg-[var(--pass)] shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
          <span className="text-[13px] font-semibold text-[var(--text-primary)]">
            AI Copilot
          </span>
        </div>
        <StatusGlyph />
      </div>
    </div>
  );
}

function StatusGlyph() {
  return (
    <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--pass)]" />
      Gate chain: deterministic
    </span>
  );
}

/* --------------------------- Empty state --------------------------- */
function EmptyState({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="py-14 text-center">
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

      <div className="mx-auto mt-8 grid max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => onPick(s)} className="chip">
            {s}
          </button>
        ))}
      </div>
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
