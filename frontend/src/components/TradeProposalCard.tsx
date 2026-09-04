import type { ProposeResponse } from "../types";
import { assertGrecks } from "../lib/primitives";
import { fmtUsd, fmtNum, assetIcon } from "../lib/format";

interface Props {
  data: ProposeResponse;
}

/**
 * Structured trade information card for a resolved /converse proposal.
 * Renders only fields the backend actually returns.
 */
export default function TradeProposalCard({ data }: Props) {
  const preview = data.preview;
  const totalCollateralUsd = Number(preview?.totalCollateral ?? "0") / 1_000_000;
  const pricePerContractUsd = preview?.pricePerContract
    ? Number(preview.pricePerContract) / 1_000_000
    : undefined;

  const asset = readAsset(data);
  const structure = readStructure(data);
  const strike = readStrike(data);

  return (
    <div className="surface overflow-hidden">
      {/* Trade identity header */}
      <div className="flex items-center gap-3 border-b border-[var(--border-faint)] px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] text-[16px] text-[var(--accent-strong)]">
          {assetIcon(asset)}
        </div>
        <div className="min-w-0">
          <div className="text-[14px] font-bold tracking-wide text-[var(--text-primary)]">
            {asset} <span className="text-[var(--text-secondary)]">{structure || "OPTION"}</span>
          </div>
          <div className="num text-[12px] text-[var(--text-muted)]">
            {strike != null ? `$${fmtNum(strike, 2)} strike` : "Resolved against live order"}
          </div>
        </div>
        <span className="ml-auto text-right">
          <div className="num text-[15px] font-semibold text-[var(--text-primary)]">
            {fmtNum(data.numContractsHuman, 0)}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            contracts
          </div>
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-4 p-4">
        <Stat label="Spot Price" value={fmtUsd(data.spotPrice)} />
        <Stat
          label="Total Collateral"
          value={totalCollateralUsd > 0 ? fmtUsd(totalCollateralUsd) : "—"}
          suffix="USDC"
        />
        {pricePerContractUsd != null && (
          <Stat label="Price / Contract" value={fmtUsd(pricePerContractUsd, 4)} />
        )}
        <DeltaStat data={data} />
        {data.requires_delta_recheck_before_settlement && (
          <Stat
            label="Delta Recheck"
            value="Advisory"
            tone="warn"
          />
        )}
      </div>
    </div>
  );
}

/** Asset symbol from the gate summary's underlying screen (real field). */
function readAsset(data: ProposeResponse): string {
  const gs = data.gate_summary;
  const underlying = (gs.underlying_screen as { symbol?: string } | undefined)?.symbol;
  return underlying?.toUpperCase() || "—";
}

/** Option structure (CALL/PUT) from the gate summary (real field). */
function readStructure(data: ProposeResponse): string {
  const gs = data.gate_summary;
  const structure = (gs.option_structure_gate as { structure?: string } | undefined)?.structure;
  return structure ? String(structure).toUpperCase() : "";
}

/** Strike from the resolved candidate order (real field). */
function readStrike(data: ProposeResponse): number | null {
  const strikes = (data.candidateOrder?.order?.strikes as unknown) as Array<string | number> | undefined;
  if (!Array.isArray(strikes) || strikes.length === 0) return null;
  const first = strikes[0];
  const n = typeof first === "number" ? first : Number(first);
  if (!Number.isFinite(n)) return null;
  return n / 1e8;
}

function Stat({
  label,
  value,
  suffix,
  tone = "default",
}: {
  label: string;
  value: string;
  suffix?: string;
  tone?: "default" | "warn";
}) {
  return (
    <div>
      <div className="label mb-1">{label}</div>
      <div
        className={`num text-[15px] leading-none font-medium ${
          tone === "warn" ? "text-[var(--warn)]" : "text-[var(--text-primary)]"
        }`}
      >
        {value}
        {suffix && (
          <span className="ml-1 text-[11px] text-[var(--text-muted)] not-num">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function DeltaStat({ data }: { data: ProposeResponse }) {
  const greeks = assertGrecks(data.candidateOrder.rawApiData);
  const delta = greeks?.delta;
  return (
    <Stat
      label="Delta"
      value={delta != null ? fmtNum(delta, 4) : "—"}
      tone={delta != null && Math.abs(delta) > 0.9 ? "warn" : "default"}
    />
  );
}
