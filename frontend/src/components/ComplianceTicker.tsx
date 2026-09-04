import { useEffect, useState } from "react";
import { getScreenedOrders } from "../api/client";
import type { ScreenedOrder } from "../types";
import { fmtNum } from "../lib/format";
import AssetIcon from "./AssetIcon";

/**
 * A live feed of real orders already run through the gate chain -- not a
 * decorative price ticker. Every row is an actual /orders/screened result:
 * proof the screening runs continuously against the live book, not only
 * when a user asks.
 */
export default function ComplianceTicker() {
  const [orders, setOrders] = useState<ScreenedOrder[]>([]);

  useEffect(() => {
    let active = true;
    let poll: number;
    async function load() {
      try {
        const data = await getScreenedOrders({ limit: 20 });
        if (active) setOrders(data.screened);
      } catch {
        // Silent -- this is ambient texture, not a page-critical feed. The
        // Desk panel's own error states already surface real connectivity
        // problems.
      }
    }
    load();
    poll = window.setInterval(load, 20000);
    return () => {
      active = false;
      window.clearInterval(poll);
    };
  }, []);

  if (orders.length === 0) return null;

  // Duplicated once so the marquee loops seamlessly at -50% translateX.
  const track = [...orders, ...orders];

  return (
    <div className="shrink-0 overflow-hidden border-t border-[var(--border-subtle)] bg-[var(--bg-app)] py-2">
      <div className="ticker-track gap-6 px-4">
        {track.map((o, i) => (
          <TickerItem key={i} order={o} />
        ))}
      </div>
    </div>
  );
}

function TickerItem({ order }: { order: ScreenedOrder }) {
  const pass = order.decision === "READY_FOR_EXECUTION";

  return (
    <div className="flex shrink-0 items-center gap-2 whitespace-nowrap text-[11.5px]">
      {order.asset && <AssetIcon asset={order.asset} size={14} />}
      <span className="num font-medium text-[var(--text-secondary)]">
        {order.asset ?? "—"} {order.optionType.toUpperCase()} ${fmtNum(order.strike, 0)}
      </span>
      <span className={pass ? "text-[var(--pass)]" : "text-[var(--reject)]"}>
        {pass ? "PASS" : order.blockers[0]?.replace(/_/g, " ") ?? "BLOCKED"}
      </span>
      <span className="text-[var(--border-strong)]">•</span>
    </div>
  );
}
