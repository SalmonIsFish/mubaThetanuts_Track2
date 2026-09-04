import { useState } from "react";
import type { ConverseResponse, ProposeResponse, ExecuteResponse } from "../types";
import TradeProposalCard from "./TradeProposalCard";
import GateChecklist from "./GateChecklist";
import ConfirmationPanel from "./ConfirmationPanel";
import ExecutionReceipt from "./ExecutionReceipt";
import { tradeIntentFromProposal, friendlyReason } from "../lib/format";

export type ChatRole = "user" | "assistant";

export interface ChatMessageData {
  role: ChatRole;
  content: string;
  converse?: ConverseResponse;
  proposal?: ProposeResponse;
  executeResult?: ExecuteResponse;
}

interface Props {
  message: ChatMessageData;
  onExecute: (proposal: ProposeResponse) => Promise<unknown>;
}

/**
 * Renders one turn in the copilot workspace.
 * - user intent renders as a compact labeled row (not a chat bubble)
 * - assistant renders the structured verdict as the hero, with the plain
 *   language explanation as a distinct "AI Assessment" prose block below it
 */
export default function ConversationMessage({ message, onExecute }: Props) {
  if (message.role === "user") {
    return (
      <div className="max-w-[560px] intent-row">
        <span className="tag">Intent</span>
        <span className="text-[13.5px] leading-relaxed text-[var(--text-primary)]">
          {message.content}
        </span>
      </div>
    );
  }

  const convo = message.converse;
  const verdict =
    convo?.status === "ready" ? (
      <Ready
        convo={convo}
        onExecute={onExecute}
        executed={message.executeResult != null}
      />
    ) : convo?.status === "rejected" ? (
      <Rejected convo={convo} />
    ) : convo?.status === "clarification_needed" ? (
      <Clarification convo={convo} />
    ) : null;

  return (
    <div className="space-y-3">
      {/* Structured verdict is the hero output */}
      {verdict && <div>{verdict}</div>}

      {/* AI assessment — plain-language note shown only when a verdict exists */}
      {message.content && verdict && (
        <div className="ai-prose pt-1">
          <div className="label mb-1">AI Assessment</div>
          <p className="text-[13.5px] leading-relaxed text-[var(--text-secondary)]">
            {message.content}
          </p>
        </div>
      )}

      {!verdict && message.content && (
        <div className="ai-prose">
          <div className="label mb-1">Copilot</div>
          <p className="text-[13.5px] leading-relaxed text-[var(--text-secondary)]">
            {message.content}
          </p>
        </div>
      )}

      {message.executeResult && <ExecutionReceipt result={message.executeResult} />}
    </div>
  );
}

/* ------------------------------ READY ------------------------------ */

function Ready({
  convo,
  onExecute,
  executed,
}: {
  convo: ConverseResponse;
  onExecute: (p: ProposeResponse) => Promise<unknown>;
  executed: boolean;
}) {
  const proposal = convo.actionable_data;
  const [confirming, setConfirming] = useState(false);
  const [executing, setExecuting] = useState(false);

  if (!proposal) return null;
  const currentProposal: ProposeResponse = proposal;
  const intent = tradeIntentFromProposal(currentProposal);

  async function run() {
    setExecuting(true);
    try {
      await onExecute(currentProposal);
      setConfirming(false);
    } finally {
      setExecuting(false);
    }
  }

  const passed = gatePassCount(currentProposal.gate_summary);

  return (
    <div className="verdict-card verdict-ready overflow-hidden">
      <div className="verdict-title">
        <span aria-hidden className="text-[15px]">✓</span>
        <span className="main">Ready for Execution</span>
        <span className="ml-auto num text-[12px] text-[var(--text-muted)]">
          {passed} / {totalGates(currentProposal.gate_summary)} gates passed
        </span>
      </div>

      <div className="p-4 space-y-3">
        <TradeProposalCard data={proposal} />
        <GateChecklist
          gateSummary={proposal.gate_summary}
          blockers={proposal.blockers}
          decision={proposal.decision}
        />

        {!executed && !confirming && (
          <div className="pt-1">
            <button onClick={() => setConfirming(true)} className="btn btn-primary w-full sm:w-auto">
              Review &amp; Confirm
            </button>
          </div>
        )}

        {confirming && !executed && (
          <ConfirmationPanel
            data={proposal}
            intent={intent}
            onConfirm={run}
            onCancel={() => setConfirming(false)}
            executing={executing}
          />
        )}
      </div>
    </div>
  );
}

/* ---------------------------- REJECTED ----------------------------- */

function Rejected({ convo }: { convo: ConverseResponse }) {
  const proposal = convo.actionable_data;
  const blockers = proposal?.blockers ?? [];
  const passed = proposal?.gate_summary ? gatePassCount(proposal.gate_summary) : 0;
  const total = proposal?.gate_summary ? totalGates(proposal.gate_summary) : 0;

  return (
    <div className="verdict-card verdict-rejected overflow-hidden">
      <div className="verdict-title">
        <span aria-hidden className="text-[15px]">✕</span>
        <span className="main">Blocked / Rejected</span>
        <span className="ml-auto num text-[12px] text-[var(--text-muted)]">
          {passed} / {total} gates passed
        </span>
      </div>

      <div className="p-4 space-y-3">
        <p className="text-[13.5px] leading-relaxed text-[var(--text-secondary)]">
          This trade cannot proceed. One or more Shariah / risk gates did not
          pass. Execution is disabled.
        </p>

        {proposal?.gate_summary && (
          <GateChecklist
            gateSummary={proposal.gate_summary}
            blockers={blockers}
            decision={proposal.decision}
          />
        )}

        {blockers.length > 0 && <BlockerList blockers={blockers} />}

        {!proposal?.gate_summary && blockers.length === 0 && (
          <p className="text-xs text-[var(--text-muted)]">
            No further gate details were returned by the backend.
          </p>
        )}

        <div className="pt-1">
          <button disabled className="btn w-full sm:w-auto opacity-60">
            ✕ Execution Disabled
          </button>
        </div>
      </div>
    </div>
  );
}

function BlockerList({ blockers }: { blockers: string[] }) {
  return (
    <div className="rounded-lg border border-[var(--reject-border)] bg-[var(--reject-bg)]/40 p-3 space-y-2">
      <span className="label text-[var(--reject)]">Blocking Conditions</span>
      {blockers.map((b) => (
        <div key={b} className="flex items-start gap-2 text-[12.5px]">
          <span aria-hidden className="mt-0.5 text-[var(--reject)]">✕</span>
          <div className="min-w-0">
            <div className="text-[var(--text-primary)]">{friendlyReason(b)}</div>
            <div className="num text-[11px] text-[var(--text-muted)]">{b}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* -------------------------- CLARIFICATION -------------------------- */

function Clarification({ convo }: { convo: ConverseResponse }) {
  return (
    <div className="verdict-card verdict-clarify overflow-hidden">
      <div className="verdict-title">
        <span aria-hidden className="text-[15px]">!</span>
        <span className="main">Clarification Needed</span>
      </div>
      <div className="p-4 space-y-2">
        <p className="text-[13.5px] leading-relaxed text-[var(--text-primary)]">
          {convo.ai_explanation}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------- utils ----------------------------- */

function gatePassCount(gateSummary: Record<string, unknown>): number {
  return Object.values(gateSummary).filter(
    (v) => (v as { status?: string } | undefined)?.status === "PASS",
  ).length;
}

function totalGates(gateSummary: Record<string, unknown>): number {
  return Object.keys(gateSummary).length;
}
