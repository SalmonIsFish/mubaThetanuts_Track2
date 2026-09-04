import type { GateSummary } from "../types";

interface Props {
  gateSummary: GateSummary | null;
  decision: string | null;
  /** Bumped by the caller on every new proposal so the reveal replays. */
  revision: number;
}

// Fixed pipeline order -- matches evaluate_thetanuts_trade() in
// gate-chain/gate_coordinator.py exactly. This is a real ordered sequence,
// not an arbitrary list, so numbering/staging it encodes something true.
const PIPELINE: { key: string; label: string }[] = [
  { key: "underlying_screen", label: "Screen" },
  { key: "collateral_gate", label: "Collateral" },
  { key: "option_structure_gate", label: "Structure" },
  { key: "delta_gate", label: "Delta" },
  { key: "risk_checks", label: "Risk" },
];

export default function GateSpine({ gateSummary, decision, revision }: Props) {
  const idle = !gateSummary;

  return (
    <div className="flex items-center gap-4 overflow-x-auto">
      <span className="label shrink-0 whitespace-nowrap">Compliance Chain</span>
      <div className="flex items-center" key={revision}>
        {PIPELINE.map((gate, i) => {
          const verdict = gateSummary?.[gate.key] as { status?: string } | undefined;
          const status = idle ? "idle" : verdict?.status === "PASS" ? "pass" : "reject";
          return (
            <div key={gate.key} className="flex items-center">
              <GateNode label={gate.label} status={status} index={i} />
              {i < PIPELINE.length - 1 && (
                <svg width="14" height="8" viewBox="0 0 14 8" fill="none" className="mx-0.5 shrink-0 text-[var(--border-strong)]" aria-hidden>
                  <path d="M0 4h11M8 1l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
          );
        })}
      </div>
      {!idle && (
        <span
          className={`num shrink-0 text-[11px] font-semibold uppercase tracking-wide ${
            decision === "READY_FOR_EXECUTION" ? "text-[var(--pass)]" : "text-[var(--reject)]"
          }`}
        >
          {decision === "READY_FOR_EXECUTION" ? "Cleared" : "Blocked"}
        </span>
      )}
    </div>
  );
}

function GateNode({ label, status, index }: { label: string; status: "idle" | "pass" | "reject"; index: number }) {
  return (
    <div
      className="gate-chip flex items-center gap-1.5 rounded-full border px-2.5 py-1"
      data-idle={status === "idle"}
      data-status={status}
      style={
        {
          "--i": index,
          borderColor:
            status === "pass" ? "var(--pass-border)" : status === "reject" ? "var(--reject-border)" : "var(--border-subtle)",
          background:
            status === "pass" ? "var(--pass-bg)" : status === "reject" ? "var(--reject-bg)" : "var(--bg-surface-2)",
        } as React.CSSProperties
      }
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{
          background: status === "pass" ? "var(--pass)" : status === "reject" ? "var(--reject)" : "var(--text-faint)",
        }}
      />
      <span
        className="whitespace-nowrap text-[11px] font-medium"
        style={{
          color: status === "pass" ? "var(--pass)" : status === "reject" ? "var(--reject)" : "var(--text-muted)",
        }}
      >
        {label}
      </span>
    </div>
  );
}
