import type {
  ConverseResponse,
  ExecuteResponse,
  MarketDataResponse,
  OrdersResponse,
  PartialIntent,
  ProposeResponse,
  ScreenedOrdersResponse,
  TradeIntent,
} from "../types";

// Respects Vite's `base` so the same build works at domain root (BASE_URL="/")
// and under a subpath like /thetanuts/ (BASE_URL="/thetanuts/"). In both
// cases `${BASE_URL}api` resolves to the correct nginx location. Override
// with VITE_API_BASE at build time if the API lives elsewhere.
const _rawBase =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? `${import.meta.env.BASE_URL}api`;
const BASE = _rawBase.replace(/\/$/, "") || "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return body as T;
}

export async function healthCheck(): Promise<{ status: string }> {
  return request("/health");
}

export async function getMarketData(): Promise<MarketDataResponse> {
  return request("/market-data");
}

export async function getOrders(params?: {
  asset?: string;
  type?: string;
}): Promise<OrdersResponse> {
  const qs = new URLSearchParams();
  if (params?.asset) qs.set("asset", params.asset);
  if (params?.type) qs.set("type", params.type);
  const q = qs.toString();
  return request(`/orders${q ? `?${q}` : ""}`);
}

export async function getScreenedOrders(params?: {
  asset?: string;
  type?: string;
  limit?: number;
}): Promise<ScreenedOrdersResponse> {
  const qs = new URLSearchParams();
  if (params?.asset) qs.set("asset", params.asset);
  if (params?.type) qs.set("type", params.type);
  if (params?.limit) qs.set("limit", String(params.limit));
  const q = qs.toString();
  return request(`/orders/screened${q ? `?${q}` : ""}`);
}

export async function proposeTrade(
  trade: TradeIntent,
): Promise<ProposeResponse> {
  return request("/propose", {
    method: "POST",
    body: JSON.stringify(trade),
  });
}

export async function executeTrade(
  trade: TradeIntent,
): Promise<ExecuteResponse> {
  return request("/execute", {
    method: "POST",
    body: JSON.stringify(trade),
  });
}

export async function converse(
  prompt: string,
  priorIntent?: PartialIntent | null,
): Promise<ConverseResponse> {
  return request("/converse", {
    method: "POST",
    body: JSON.stringify({ prompt, priorIntent: priorIntent ?? null }),
  });
}
