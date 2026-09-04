import { useEffect, useState } from "react";
import { getMarketData } from "../api/client";
import { fmtUsd } from "../lib/format";
import AssetIcon from "./AssetIcon";

const ASSETS = ["ETH", "BTC", "SOL", "AVAX", "XRP", "BNB", "DOGE", "PAXG"];

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
        <div className="flex items-center gap-2">
          <span
            className="num rounded border px-1.5 py-[1px] text-[10px] font-semibold"
            style={{ color: "var(--chain-strong)", background: "var(--chain-ink)", borderColor: "var(--chain-dim)" }}
            title="Settles on Base mainnet"
          >
            BASE · 8453
          </span>
          <span
            className={`h-1.5 w-1.5 rounded-full ${error ? "bg-[var(--reject)]" : "bg-[var(--pass)]"}`}
            title={error ?? "Live"}
          />
        </div>
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
              <AssetIcon asset={a} size={22} />
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
