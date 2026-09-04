export type Decision = "READY_FOR_EXECUTION" | "BLOCKED";

export type GateStatus = "PASS" | "REJECT";

export interface GateVerdict {
  status: GateStatus;
  reason: string;
  [key: string]: unknown;
}

export interface GateSummary {
  underlying_screen?: GateVerdict & { symbol?: string; category?: string };
  collateral_gate?: GateVerdict & { token?: string };
  option_structure_gate?: GateVerdict & { structure?: string };
  delta_gate?: GateVerdict & { abs_delta?: number };
  risk_checks?: GateVerdict & {
    limits?: {
      max_notional_usd_per_trade?: number;
      max_notional_usd_per_day?: number;
      max_orders_per_day?: number;
    };
  };
  [key: string]: unknown;
}

export interface ProposeResponse {
  candidateOrder: { order: Record<string, unknown>; rawApiData?: Record<string, unknown> };
  preview: { numContracts: string; pricePerContract?: string; totalCollateral: string };
  numContractsHuman: number;
  spotPrice: number;
  decision: Decision;
  blockers: string[];
  gate_summary: GateSummary;
  requires_delta_recheck_before_settlement: boolean;
}

export interface ExecuteResponse {
  txHash: string;
  basescanUrl: string;
  account: string;
  numContractsFilled: string;
  numContractsFilledHuman: number;
  decision: Decision;
  gate_summary: GateSummary;
}

export type ConverseStatus = "ready" | "rejected" | "clarification_needed";

export interface PartialIntent {
  asset: string | null;
  optionType: string | null;
  spendUsdc: number | null;
}

export interface ConverseResponse {
  status: ConverseStatus;
  actionable_data: ProposeResponse | null;
  ai_explanation: string;
  partial_intent?: PartialIntent | null;
}

export interface MarketDataResponse {
  prices: Record<string, number>;
  metadata?: Record<string, unknown>;
}

export interface ScreenedOrder {
  asset: string | null;
  optionType: string;
  strike: number;
  maker: string;
  expiry: string;
  decision: Decision | "UNSCREENED";
  blockers: string[];
  gate_summary: GateSummary | null;
}

export interface ScreenedOrdersResponse {
  count: number;
  compliantCount: number;
  screened: ScreenedOrder[];
}

export interface OrderEntry {
  order: Record<string, unknown>;
  rawApiData?: { greeks?: { delta?: number }; isCall?: boolean; priceFeed?: string };
  makerAddress?: string;
}

export interface OrdersResponse {
  count: number;
  orders: OrderEntry[];
}

export type TradeIntent = {
  asset: string;
  optionType: string;
  side: string;
  spendUsdc: number;
};
