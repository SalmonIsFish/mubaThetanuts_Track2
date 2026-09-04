import type { ProposeResponse, TradeIntent } from "../types";

export function fmtUsd(n: number | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function fmtNum(n: number | undefined, digits = 6): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

export function fmtAddress(a: string | undefined, keep = 6): string {
  if (!a) return "—";
  return `${a.slice(0, keep)}…${a.slice(-4)}`;
}

export function fmtContract(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

/**
 * Derive a TradeIntent (the /execute contract: {asset, optionType, side,
 * spendUsdc}) from a /converse proposal's actionable_data. /converse does not
 * return the raw intent, so it is reconstructed from the gate summary and
 * preview. side is always BUY (the only path the API implements).
 */
export function tradeIntentFromProposal(p: ProposeResponse): TradeIntent {
  const gs = p.gate_summary;

  const underlying = gs.underlying_screen as
    | { symbol?: string }
    | undefined;
  const asset = (underlying?.symbol ?? "").toUpperCase() || "ETH";

  const structure = (
    (gs.option_structure_gate as { structure?: string } | undefined)
      ?.structure ?? ""
  ).toUpperCase();
  const optionType = structure.includes("PUT") ? "put" : "call";

  const collateralUsdc = Number(p.preview?.totalCollateral ?? "0") / 1_000_000;
  const spendUsdc = collateralUsdc > 0 ? collateralUsdc : 1;

  return { asset, optionType, side: "BUY", spendUsdc };
}

/** Human-readable label for a raw gate / blocker reason code. */
const REASON_FRIENDLY: Record<string, string> = {
  token_compliant: "Underlying asset is Shariah-compliant",
  token_not_compliant: "Underlying asset is not Shariah-compliant",
  token_missing: "Underlying asset is not in the reviewed universe",
  fully_collateralized_self_funded: "Collateral is fully funded by the user",
  borrowed_collateral: "Collateral is borrowed / leveraged",
  fully_paid_long_position: "Fully-paid long option position",
  delta_within_band: "Delta is within the acceptable band",
  delta_rejected: "Delta is outside the acceptable band",
  notional_within_caps: "Notional is within daily & per-trade caps",
  notional_over_cap: "Notional exceeds the configured cap",
};

export function friendlyReason(reason: string | undefined): string {
  if (!reason) return "";
  if (REASON_FRIENDLY[reason]) return REASON_FRIENDLY[reason];
  return reason.replace(/_/g, " ");
}
