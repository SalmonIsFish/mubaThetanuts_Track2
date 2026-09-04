import { useEffect, useState } from "react";
import { getScreenedOrders } from "../api/client";
import type { ScreenedOrder } from "../types";
import { fmtNum } from "../lib/format";
import AssetIcon from "./AssetIcon";

type TypeFilter = "all" | "put" | "call";

const FILTERS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "put", label: "Puts" },
  { value: "call", label: "Calls" },
];

// Every row here is a real /orders/screened result -- the live book run
// through the same gate chain a trade would hit, not a decorative order
// list. That's the point: compliance isn't only checked when a user asks.
export default function OrdersPanel() {
  const [orders, setOrders] = useState<ScreenedOrder[]>([]);
  const [compliantCount, setCompliantCount] = useState(0);
  const [filter, setFilter] = useState<TypeFilter>("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let poll: number;
    async function load() {
      try {
        const data = await getScreenedOrders({ limit: 60 });
        if (active) {
          setOrders(data.screened);
          setCompliantCount(data.compliantCount);
          setError(null);
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Failed");
      }
    }
    load();
    poll = window.setInterval(load, 20000);
    return () => {
      active = false;
      window.clearInterval(poll);
    };
  }, []);

  const filtered = filter === "all" ? orders : orders.filter((o) => o.optionType === filter);

  return (
    <section className="surface p-3.5">
      <header className="mb-2.5 flex items-center justify-between">
        <h3 className="label">Live Orders — Screened</h3>
        <span className="num text-[11px] text-[var(--text-muted)]">
          <span className="text-[var(--pass)]">{compliantCount}</span>/{orders.length} compliant
        </span>
      </header>

      <div className="mb-2.5 flex gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
              filter === f.value
                ? "bg-[var(--bg-hover)] text-[var(--text-primary)] border border-[var(--border-strong)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">{error}</p>}

      <div className="max-h-[340px] overflow-y-auto">
        {orders.length === 0 && !error && (
          <p className="py-6 text-center text-[11.5px] text-[var(--text-faint)]">
            No live orders available.
          </p>
        )}
        {filtered.length === 0 && orders.length > 0 && (
          <p className="py-4 text-center text-[11.5px] text-[var(--text-faint)]">
            No {filter === "put" ? "puts" : "calls"} right now.
          </p>
        )}
        {filtered.map((o, i) => (
          <OrderRow key={i} order={o} />
        ))}
      </div>
    </section>
  );
}

function OrderRow({ order }: { order: ScreenedOrder }) {
  const isCall = order.optionType === "call";
  const pass = order.decision === "READY_FOR_EXECUTION";
  const absDelta = order.gate_summary?.delta_gate?.abs_delta as number | undefined;

  return (
    <div className="row flex items-center justify-between gap-2 py-2 text-[12px]">
      <div className="flex min-w-0 items-center gap-1.5">
        {order.asset && <AssetIcon asset={order.asset} size={16} />}
        <span
          className={`inline-flex h-5 min-w-[36px] items-center justify-center rounded px-1.5 text-[10.5px] font-semibold uppercase ${
            isCall
              ? "bg-[var(--info-bg)] text-[var(--info)] border border-[var(--info-border)]"
              : "bg-[var(--warn-bg)] text-[var(--warn)] border border-[var(--warn-border)]"
          }`}
        >
          {isCall ? "Call" : "Put"}
        </span>
        <span className="num text-[var(--text-secondary)]">${fmtNum(order.strike, 0)}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {absDelta != null && <span className="num text-[11px] text-[var(--text-muted)]">Δ {absDelta.toFixed(3)}</span>}
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${pass ? "bg-[var(--pass)]" : "bg-[var(--reject)]"}`}
          title={pass ? "Ready for execution" : order.blockers.join(", ")}
        />
      </div>
    </div>
  );
}
