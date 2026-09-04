import { useEffect, useState } from "react";
import CopilotWorkspace from "./CopilotWorkspace";
import MarketPrices from "./MarketPrices";
import OrdersPanel from "./OrdersPanel";
import QuantPanel from "./QuantPanel";
import GateSpine from "./GateSpine";
import ComplianceTicker from "./ComplianceTicker";
import { healthCheck } from "../api/client";
import type { GateSummary } from "../types";

type View = "copilot";

interface LatestGate {
  gateSummary: GateSummary;
  decision: string;
}

export default function AppShell() {
  const [view, setView] = useState<View>("copilot");
  const [latestGate, setLatestGate] = useState<LatestGate | null>(null);
  const [gateRevision, setGateRevision] = useState(0);

  function onGateResult(next: LatestGate) {
    setLatestGate(next);
    setGateRevision((r) => r + 1);
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      {/* Persistent compliance masthead — larger for recording, full width */}
      <header className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-3">
        <div className="[&_*]:text-[13px] [&_span]:font-semibold">
          <GateSpine
            gateSummary={latestGate?.gateSummary ?? null}
            decision={latestGate?.decision ?? null}
            revision={gateRevision}
          />
        </div>
      </header>

      {/* Recordable 3-column layout: LIVE MARKET | COPILOT (focus) | SCREENED + QUANT — single screen, no scroll */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <SideRail view={view} onView={setView} />

        <div className="grid flex-1 min-h-0 gap-3 p-3" style={{ gridTemplateColumns: "240px 1fr 320px" }}>
          {/* Left — Live Market compact */}
          <aside className="flex flex-col overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5" style={{ scrollbarWidth: "none" } as React.CSSProperties}>
            <MarketPrices />
            <div className="mt-3">
              <QuantPanel />
            </div>
          </aside>

          {/* Center — Copilot is the main event */}
          <main className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <CopilotWorkspace onGateResult={onGateResult} />
          </main>

          {/* Right — Screened Orders */}
          <aside className="flex flex-col overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5" style={{ scrollbarWidth: "none" } as React.CSSProperties}>
            <OrdersPanel />
            <div className="mt-3 rounded-lg border border-[var(--border-faint)] bg-[var(--bg-surface-2)] p-3">
              <div className="label mb-1.5">Desk</div>
              <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                Prices refresh every 15s, orders every 20s. The gate chain decides compliance — this panel only surfaces it.
              </p>
            </div>
          </aside>
        </div>
      </div>

      <ComplianceTicker />
    </div>
  );
}

/* ------------------------------ Rail ------------------------------- */
function SideRail({ view, onView }: { view: View; onView: (v: View) => void }) {
  const connected = useHealth();
  return (
    <nav className="flex w-14 shrink-0 flex-col items-center border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] py-3">
      {/* Brand */}
      <div className="mb-6 flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--accent-dim)] bg-[var(--accent-ink)] text-[var(--accent-strong)] text-lg">
        ⚖
      </div>

      <RailButton
        active={view === "copilot"}
        onClick={() => onView("copilot")}
        label="Copilot"
        icon="💬"
      />

      <div className="mt-auto">
        <div className="flex flex-col items-center gap-2">
          <div
            className="flex items-center gap-1.5 text-[10px] text-[var(--text-faint)]"
            title={connected ? "Connected to API" : "API unreachable"}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                connected === false
                  ? "bg-[var(--reject)]"
                  : connected
                    ? "bg-[var(--pass)]"
                    : "bg-[var(--warn)]"
              }`}
            />
          </div>
        </div>
      </div>
    </nav>
  );
}

function RailButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`group relative flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-[10px] transition-colors ${
        active
          ? "text-[var(--accent-strong)]"
          : "text-[var(--text-faint)] hover:text-[var(--text-secondary)]"
      }`}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-[var(--accent)]" />
      )}
      <span className="text-[15px] leading-none">{icon}</span>
      <span className="text-[9.5px] font-medium">{label}</span>
    </button>
  );
}

function useHealth() {
  const [connected, setConnected] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    async function check() {
      try {
        await healthCheck();
        if (active) setConnected(true);
      } catch {
        if (active) setConnected(false);
      }
    }
    check();
    const id = window.setInterval(check, 10000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);
  return connected;
}
