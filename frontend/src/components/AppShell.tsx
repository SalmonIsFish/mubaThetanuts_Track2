import { useEffect, useState } from "react";
import CopilotWorkspace from "./CopilotWorkspace";
import MarketPrices from "./MarketPrices";
import OrdersPanel from "./OrdersPanel";
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
      {/* Persistent compliance masthead -- visible before a single message
          is sent, so the pipeline is the first thing anyone sees. */}
      <header className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-2.5">
        <GateSpine
          gateSummary={latestGate?.gateSummary ?? null}
          decision={latestGate?.decision ?? null}
          revision={gateRevision}
        />
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left nav rail */}
        <SideRail view={view} onView={setView} />

        {/* Main workspace */}
        <main className="flex-1 min-w-0 overflow-hidden">
          <CopilotWorkspace onGateResult={onGateResult} />
        </main>

        {/* Right Desk panel */}
        <DeskPanel />
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

/* ---------------------------- Desk panel --------------------------- */
function DeskPanel() {
  const [open, setOpen] = useState(() => window.innerWidth >= 1024);

  return (
    <>
      {/* Desktop fixed desk */}
      <aside className="hidden w-[340px] shrink-0 flex-col overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] lg:flex">
        <DeskContent />
      </aside>

      {/* Tablet / mobile toggle */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed right-4 bottom-4 z-40 flex h-11 items-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-4 text-[13px] font-medium text-[var(--text-secondary)] shadow-lg lg:hidden"
      >
        {open ? "Hide Desk" : "Show Desk"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={() => setOpen(false)}
        >
          <aside
            className="absolute right-0 top-0 h-full w-[320px] overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="label">Desk</span>
              <button
                onClick={() => setOpen(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                aria-label="Close desk"
              >
                ✕
              </button>
            </div>
            <DeskContent />
          </aside>
        </div>
      )}
    </>
  );
}

function DeskContent() {
  return (
    <div className="space-y-3 p-3">
      <MarketPrices />
      <OrdersPanel />
      <div className="rounded-lg border border-[var(--border-faint)] bg-[var(--bg-surface-2)] p-3">
        <div className="label mb-1.5">Desk</div>
        <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
          Live context for the copilot. Prices refresh every 15s, orders every
          20s. The gate chain decides compliance — this panel only surfaces it.
        </p>
      </div>
    </div>
  );
}
