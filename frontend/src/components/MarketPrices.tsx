import { useEffect, useState } from "react";
import { getMarketData } from "../api/client";
import { fmtUsd, assetIcon } from "../lib/format";
import PanelState from "./PanelState";

const ASSETS = ["ETH", "BTC", "SOL"];

export default function MarketPrices() {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    let poll: number;
    async function load() {
      try {
        const data = await getMarketData();
        if (active) {
          setPrices(data.prices);
          setUnavailable(false);
        }
      } catch {
        if (active) setUnavailable(true);
      }
    }
    load();
    poll = window.setInterval(load, 15000);
    return () => {
      active = false;
      window.clearInterval(poll);
    };
  }, []);

  return (
    <section className="surface p-3.5">
      <header className="flex items-center justify-between mb-2.5">
        <h3 className="label">Live Market</h3>
        <span className="sys-ind" title={unavailable ? "Feed unavailable" : "Live"}>
          <span className={`lamp ${unavailable ? "lamp-reject" : "lamp-pass"}`} aria-hidden />
          <span className="val">{unavailable ? "OFFLINE" : "LIVE"}</span>
        </span>
      </header>

      {unavailable ? (
        <PanelState
          icon="◌"
          title="Market feed unavailable"
          detail="Spot prices could not be loaded from the execution service."
          retry="auto"
        />
      ) : (
        <div className="space-y-1">
          {ASSETS.map((a) => (
            <div
              key={a}
              className="flex items-center justify-between rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--bg-hover)]"
            >
              <div className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 items-center justify-center rounded border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] text-[13px] text-[var(--text-secondary)]">
                  {assetIcon(a)}
                </span>
                <span className="text-[13px] font-medium text-[var(--text-primary)]">
                  {a}
                </span>
              </div>
              <span className="num text-[13px] text-[var(--text-secondary)]">
                {prices[a] != null ? fmtUsd(prices[a]) : <SkeletonInline />}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SkeletonInline() {
  return <span className="skeleton inline-block h-3 w-16 align-middle" />;
}
