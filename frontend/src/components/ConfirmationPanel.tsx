import type { ProposeResponse, TradeIntent } from "../types";
import { fmtUsd, fmtNum } from "../lib/format";
import Spinner from "./Spinner";

interface Props {
  data: ProposeResponse;
  intent: TradeIntent;
  onConfirm: () => void;
  onCancel: () => void;
  executing: boolean;
}

export default function ConfirmationPanel({
  data,
  intent,
  onConfirm,
  onCancel,
  executing,
}: Props) {
  const totalCollateralUsd = Number(data.preview?.totalCollateral ?? "0") / 1_000_000;

  return (
    <div className="verdict-card verdict-ready border-2 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <span className="label">Confirm Execution</span>
        <span className="state-badge state-pass">
          <span aria-hidden>✓</span> Ready
        </span>
      </div>

      {/* Terms recap — exact values being submitted */}
      <div className="rounded-lg border border-[var(--border-faint)] bg-[var(--bg-surface-2)] p-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Field label="Asset" value={intent.asset} mono={false} />
          <Field label="Type" value={`${intent.optionType.toUpperCase()} (BUY)`} mono={false} />
          <Field
            label="Spend / Collateral"
            value={totalCollateralUsd > 0 ? fmtUsd(totalCollateralUsd) : `$${fmtNum(intent.spendUsdc, 0)}`}
          />
          <Field label="Contracts" value={fmtNum(data.numContractsHuman, 6)} />
          <Field label="Spot" value={fmtUsd(data.spotPrice)} />
          <Field label="Decision" value="READY_FOR_EXECUTION" mono={false} />
        </div>
      </div>

      <p className="text-xs leading-relaxed text-[var(--text-muted)]">
        This submits a fresh resolve-and-gate-check to the backend{" "}
        <span className="text-[var(--text-secondary)]">POST /execute</span>. The server re-resolves
        against live orders, re-runs the gate chain, and only broadcasts if it returns{" "}
        <span className="text-[var(--pass)]">READY_FOR_EXECUTION</span>. Signing happens server-side —
        no private key touches this browser.
      </p>

      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          disabled={executing}
          className="btn btn-execute flex-1"
        >
          {executing && <Spinner size={14} />}
          {executing ? "Executing…" : "Confirm & Execute"}
        </button>
        <button onClick={onCancel} disabled={executing} className="btn btn-ghost">
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="label mb-1">{label}</div>
      <div
        className={`text-[13.5px] font-medium text-[var(--text-primary)] ${
          mono ? "num" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
