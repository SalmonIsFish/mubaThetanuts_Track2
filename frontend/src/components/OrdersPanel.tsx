import { useEffect, useState } from "react";
import { getOrders } from "../api/client";
import type { OrderEntry } from "../types";
import PanelState from "./PanelState";

type TypeFilter = "all" | "put" | "call";

const FILTERS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "put", label: "Puts" },
  { value: "call", label: "Calls" },
];

export default function OrdersPanel() {
  const [orders, setOrders] = useState<OrderEntry[]>([]);
  const [filter, setFilter] = useState<TypeFilter>("all");
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    let poll: number;
    async function load() {
      try {
        const data = await getOrders();
        if (active) {
          setOrders(data.orders);
          setUnavailable(false);
        }
      } catch {
        if (active) setUnavailable(true);
      }
    }
    load();
    poll = window.setInterval(load, 20000);
    return () => {
      active = false;
      window.clearInterval(poll);
    };
  }, []);

  const filtered =
    filter === "all"
      ? orders
      : orders.filter((o) => (filter === "call") === Boolean(o.rawApiData?.isCall));

  const putCount = orders.filter((o) => !o.rawApiData?.isCall).length;

  return (
    <section className="surface p-3.5">
      <header className="mb-2.5 flex items-center justify-between">
        <h3 className="label">Live Orders</h3>
        <span className="num text-[11px] text-[var(--text-muted)]">
          {unavailable ? "—" : orders.length}
        </span>
      </header>

      <div className="mb-2.5 flex gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            disabled={unavailable || orders.length === 0}
            className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors disabled:opacity-40 ${
              filter === f.value
                ? "bg-[var(--bg-hover)] text-[var(--text-primary)] border border-[var(--border-strong)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="max-h-[340px] overflow-y-auto">
        {unavailable ? (
          <PanelState
            icon="◌"
            title="Order feed unavailable"
            detail="Live orders could not be loaded from the execution service."
            retry="auto"
          />
        ) : orders.length === 0 ? (
          <PanelState
            icon="▦"
            title="No orders on the desk"
            detail="There are no option orders listed right now."
          />
        ) : filtered.length === 0 ? (
          <PanelState
            icon="▦"
            title={`No ${filter} orders`}
            detail={`There are no ${filter === "put" ? "puts" : "calls"} listed right now.`}
          />
        ) : (
          filtered.map((o, i) => <OrderRow key={i} order={o} />)
        )}
      </div>

      {!unavailable && orders.length > 0 && (
        <p className="mt-2 text-[10.5px] text-[var(--text-faint)]">
          {filter} · {putCount} puts listed
        </p>
      )}
    </section>
  );
}

function OrderRow({ order }: { order: OrderEntry }) {
  const isCall = Boolean(order.rawApiData?.isCall);
  const strikeRaw = readStrike(order);
  const delta = order.rawApiData?.greeks?.delta;
  const expiry = readExpiry(order);

  return (
    <div className="row grid grid-cols-[auto_1fr_auto] items-center gap-2 py-2 text-[12px]">
      <span
        className={`inline-flex h-5 min-w-[40px] items-center justify-center rounded px-1.5 text-[10.5px] font-semibold uppercase ${
          isCall
            ? "bg-[var(--info-bg)] text-[var(--info)] border border-[var(--info-border)]"
            : "bg-[var(--warn-bg)] text-[var(--warn)] border border-[var(--warn-border)]"
        }`}
      >
        {isCall ? "Call" : "Put"}
      </span>

      <div className="min-w-0">
        <div className="num truncate text-[var(--text-primary)]">
          {strikeRaw != null ? `$${formatStrike(strikeRaw)}` : "—"}
        </div>
        {expiry && (
          <div className="num text-[10.5px] text-[var(--text-muted)]">{expiry}</div>
        )}
      </div>

      <span className="num text-[11px] text-[var(--text-muted)]">
        {delta != null ? `Δ ${delta.toFixed(3)}` : ""}
      </span>
    </div>
  );
}

function readStrike(order: OrderEntry): number | null {
  const s = (order.order?.strikes as unknown) as Array<string | number> | undefined;
  if (!Array.isArray(s) || s.length === 0) return null;
  const first = s[0];
  const n = typeof first === "number" ? first : Number(first);
  if (!Number.isFinite(n)) return null;
  return n / 1e8;
}

function formatStrike(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function readExpiry(order: OrderEntry): string | null {
  const raw = (order.order?.expiry as unknown) as string | number | bigint | undefined;
  if (raw == null) return null;
  const secs = typeof raw === "bigint" ? Number(raw) : typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(secs) || secs <= 0) return null;
  const d = new Date(secs * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
