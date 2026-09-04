import { useState } from "react";
import type { ConverseResponse, ProposeResponse, ExecuteResponse } from "../types";
import StatusBadge from "./StatusBadge";
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
 * Renders one assistant turn as structured UI cards(never raw JSON).
 * Distinguishes ready / rejected / clarification_needed.
 */
export default function ConversationMessage({ message, onExecute }: Props) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[82%] rounded-xl rounded-tr-sm border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] px-4 py-2.5 text-[13.5px] leading-relaxed text-[var(--text-primary)]">
          {message.content}
        </div>
      </div>
    );
  }

  const convo = message.converse;

  return (
    <div className="flex gap-3">
      <AssistantAvatar />
      <div className="flex-1 min-w-0 space-y-3 max-w-[820px]">
        {/* Plain-language explanation always rendered first */}
        <div className="text-[14px] leading-relaxed text-[var(--text-secondary)]">
          {message.content}
        </div>

        {convo?.status === "clarification_needed" && <Clarification convo={convo} />}
        {convo?.status === "rejected" && <Rejected convo={convo} />}
        {convo?.status === "ready" && (
          <Ready
            convo={convo}
            onExecute={onExecute}
            executed={message.executeResult != null}
          />
        )}

        {message.executeResult && <ExecutionReceipt result={message.executeResult} />}
      </div>
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

  return (
    <div className="verdict-card verdict-ready space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="label">Approved Proposal</span>
        <StatusBadge kind="pass" label="Ready for Execution" icon="✓" />
      </div>

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
  );
}

/* ---------------------------- REJECTED ----------------------------- */

function Rejected({ convo }: { convo: ConverseResponse }) {
  const proposal = convo.actionable_data;
  const blockers = proposal?.blockers ?? [];

  return (
    <div className="verdict-card verdict-rejected space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="label">Blocked by Gate Chain</span>
        <StatusBadge kind="reject" label="Rejected" icon="✕" />
      </div>

      <p className="text-[13.5px] leading-relaxed text-[var(--text-secondary)]">
        This trade cannot proceed. One or more Shariah / risk gates did not pass.
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
    <div className="verdict-card verdict-clarify space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="label">Need More Information</span>
        <StatusBadge kind="warn" label="Clarification Needed" icon="!" />
      </div>
      <p className="text-[13.5px] leading-relaxed text-[var(--text-primary)]">
        {convo.ai_explanation}
      </p>
    </div>
  );
}

/* ------------------------------ AVATAR ----------------------------- */

function AssistantAvatar() {
  return (
    <div className="mt-0.5 h-7 w-7 shrink-0 rounded-md border border-[var(--accent-dim)] bg-[var(--accent-ink)] text-[var(--accent-strong)] flex items-center justify-center text-[13px] font-semibold">
      ⚖
    </div>
  );
}
