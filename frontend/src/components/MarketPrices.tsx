import { useEffect, useState } from "react";
import { getMarketData } from "../api/client";
import { fmtUsd, assetIcon } from "../lib/format";

const ASSETS = ["ETH", "BTC", "SOL"];

export default function MarketPrices() {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let poll: number;
    async function load() {
      try {
        const data = await getMarketData();
        if (active) {
          setPrices(data.prices);
          setError(null);
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Failed to load");
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
        <span className="sys-ind" title={error ?? "Live"}>
          <span className={`lamp ${error ? "lamp-reject" : "lamp-pass"}`} aria-hidden />
          <span className="val">{error ? "OFFLINE" : "LIVE"}</span>
        </span>
      </header>

      {error && (
        <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
          {error}
        </p>
      )}

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
    </section>
  );
}

function SkeletonInline() {
  return <span className="skeleton inline-block h-3 w-16 align-middle" />;
}
