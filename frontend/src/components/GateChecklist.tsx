import type { GateSummary } from "../types";
import { friendlyReason } from "../lib/format";
import CategoryBadge from "./CategoryBadge";

interface Props {
  gateSummary: GateSummary;
  blockers?: string[];
  decision: string;
}

interface GateMeta {
  label: string;
  icon: string;
  blurb: string;
}

const GATE_META: Record<string, GateMeta> = {
  underlying_screen: {
    label: "Underlying Screen",
    icon: "shariah",
    blurb: "Is the underlying asset Shariah-compliant?",
  },
  collateral_gate: {
    label: "Collateral Gate",
    icon: "collateral",
    blurb: "Is collateral fully-funded and compliant?",
  },
  option_structure_gate: {
    label: "Structure Gate",
    icon: "structure",
    blurb: "Is the option structure permissible?",
  },
  delta_gate: {
    label: "Delta Gate",
    icon: "delta",
    blurb: "Is the delta within the safe band?",
  },
  risk_checks: {
    label: "Risk Checks",
    icon: "risk",
    blurb: "Are notional & volume limits respected?",
  },
};

function GateIcon({ name, pass }: { name: string; pass: boolean }) {
  const id = GATE_META[name]?.icon ?? "generic";
  const stroke = pass ? "currentColor" : "currentColor";
  const cls = `w-3.5 h-3.5 ${pass ? "text-[var(--pass)]" : "text-[var(--reject)]"}`;

  switch (id) {
    case "shariah":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 6 9 17l-5-5" />
          <path d="M4 12v7a1 1 0 0 0 1 1h15" />
        </svg>
      );
    case "collateral":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
          <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
          <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
        </svg>
      );
    case "structure":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" aria-hidden>
          <rect x="2" y="15" width="4" height="7" rx="1" />
          <rect x="10" y="10" width="4" height="12" rx="1" />
          <rect x="18" y="5" width="4" height="17" rx="1" />
        </svg>
      );
    case "delta":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M3 20h18" />
          <path d="m5 16 4-4 4 3 6-7" />
        </svg>
      );
    case "risk":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        </svg>
      );
    default:
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
  }
}

export default function GateChecklist({ gateSummary, blockers = [], decision }: Props) {
  const entries = Object.entries(gateSummary) as [string, { status?: string; reason?: string; [k: string]: unknown }][];
  const passed = entries.filter(([, v]) => v?.status === "PASS").length;

  if (entries.length === 0) {
    return (
      <div className="text-xs text-[var(--text-muted)] px-1 py-2">
        No gate data returned by the backend.
      </div>
    );
  }

  return (
    <div>
      {/* Compact overall summary */}
      <div className="flex items-center justify-between mb-3">
        <span className="label">Shariah &amp; Risk Gates</span>
        <span
          className={`num ${
            decision === "READY_FOR_EXECUTION"
              ? "text-[var(--pass)]"
              : decision === "BLOCKED"
                ? "text-[var(--reject)]"
                : "text-[var(--text-secondary)]"
          }`}
        >
          {passed}/{entries.length} passed
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--border-faint)]">
        {entries.map(([key, verdict], idx) => {
          const meta = GATE_META[key] ?? { label: key.replace(/_/g, " "), icon: "generic", blurb: "" };
          const pass = verdict?.status === "PASS";
          const isBlocked = blockers.some((b) => key.includes(b));
          return (
            <div
              key={key}
              className={`gate-row-reveal flex items-start gap-3 px-3 py-2.5 ${
                idx > 0 ? "border-t border-[var(--border-faint)]" : ""
              } ${!pass ? "bg-[var(--reject-bg)]/30" : ""}`}
              style={{ "--i": idx } as React.CSSProperties}
            >
              <div className="mt-0.5 shrink-0 rounded-md border border-[var(--border-faint)] bg-[var(--bg-surface-2)] p-1.5 flex items-center justify-center">
                <GateIcon name={key} pass={pass} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-medium text-[var(--text-primary)]">
                    {meta.label}
                  </span>
                  <span className={pass ? "state-badge state-pass" : "state-badge state-reject"}>
                    <span aria-hidden>{pass ? "✓" : "✕"}</span>
                    {pass ? "Pass" : "Rejected"}
                  </span>
                  <CategoryBadge category={rowCategory(key, verdict)} />
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-0.5 break-words">
                  {pass
                    ? friendlyReason(verdict?.reason)
                    : friendlyReason(verdict?.reason) || (isBlocked ? "Blocked by gate chain" : "Failed")}
                  {verdictSymbolSuffix(key, verdict)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** underlying_screen carries category directly; collateral_gate nests it
 * under token_screen (the collateral token's own compliance check). */
function rowCategory(key: string, v: Record<string, unknown>): string | undefined {
  if (key === "underlying_screen") return v.category as string | undefined;
  if (key === "collateral_gate") return (v.token_screen as { category?: string } | undefined)?.category;
  return undefined;
}

function verdictSymbolSuffix(
  key: string,
  v: { symbol?: string; token?: string; abs_delta?: number; structure?: string; [k: string]: unknown },
): string {
  const parts: string[] = [];
  if (v.symbol) parts.push(v.symbol);
  else if (v.token) parts.push(v.token);
  if (key === "delta_gate" && v.abs_delta != null)
    parts.push(`|Δ| ${Number(v.abs_delta).toFixed(3)}`);
  if (key === "option_structure_gate" && v.structure)
    parts.push(String(v.structure));
  return parts.length ? ` — ${parts.join(" · ")}` : "";
}
