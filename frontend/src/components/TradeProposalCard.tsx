import type { ProposeResponse } from "../types";
import { assertGrecks } from "../lib/primitives";
import { fmtUsd, fmtNum } from "../lib/format";

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

  return (
    <div className="surface p-4">
      <div className="label mb-3">Resolved Trade</div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-4">
        <Stat label="Spot Price" value={fmtUsd(data.spotPrice)} />
        <Stat label="Contracts" value={fmtNum(data.numContractsHuman, 6)} />
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
