import { useEffect, useState } from "react";
import CopilotWorkspace from "./CopilotWorkspace";
import MarketPrices from "./MarketPrices";
import OrdersPanel from "./OrdersPanel";
import { healthCheck } from "../api/client";

type View = "copilot";

export default function AppShell() {
  const [view, setView] = useState<View>("copilot");
  const system = useSystemStatus();

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      {/* Top institutional status bar */}
      <TopBar system={system} />

      <div className="flex flex-1 min-h-0">
        {/* Left nav rail */}
        <SideRail view={view} onView={setView} connected={system.api} />

        {/* Main workspace */}
        <main className="flex-1 min-w-0 overflow-hidden">
          <CopilotWorkspace />
        </main>

        {/* Right Desk panel */}
        <DeskPanel api={system.api} />
      </div>
    </div>
  );
}

/* --------------------------- System status -------------------------- */
type SystemStatus = { api: "online" | "offline" | "checking" };

function useSystemStatus(): SystemStatus {
  const [api, setApi] = useState<SystemStatus["api"]>("checking");
  useEffect(() => {
    let active = true;
    async function check() {
      try {
        await healthCheck();
        if (active) setApi("online");
      } catch {
        if (active) setApi("offline");
      }
    }
    check();
    const id = window.setInterval(check, 10000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);
  return { api };
}

/* ------------------------------ Top bar ----------------------------- */
function TopBar({ system }: { system: SystemStatus }) {
  return (
    <header className="band flex h-11 shrink-0 items-center justify-between gap-4 px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[var(--accent-dim)] bg-[var(--accent-ink)] text-[var(--accent-strong)] text-[15px]">
          ⚖
        </div>
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-bold tracking-wide text-[var(--text-primary)]">
            THETANUTS · SHARIAH RISK COPILOT
          </div>
          <div className="truncate text-[10px] tracking-[0.08em] text-[var(--text-muted)] uppercase">
            Base · Options Desk
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 sm:gap-5 overflow-x-auto">
        <SysInd lamp="pass" label="Market" value="LIVE" />
        <SysInd lamp="pass" label="Risk Engine" value="DETERMINISTIC" />
        <SysInd lamp="pass" label="Gate Chain" value="FAIL-CLOSED" />
        <SysInd
          lamp={system.api === "online" ? "pass" : system.api === "offline" ? "reject" : "warn"}
          label="API"
          value={system.api === "online" ? "ONLINE" : system.api === "offline" ? "OFFLINE" : "CHECKING"}
        />
      </div>
    </header>
  );
}

function SysInd({
  lamp,
  label,
  value,
}: {
  lamp: "pass" | "reject" | "warn" | "info" | "dim";
  label: string;
  value: string;
}) {
  return (
    <span className="sys-ind" title={`${label}: ${value}`}>
      <span className={`lamp lamp-${lamp}`} aria-hidden />
      <span>{label}</span>
      <span className="val num">{value}</span>
    </span>
  );
}

/* ------------------------------ Rail ------------------------------- */
function SideRail({
  view,
  onView,
  connected,
}: {
  view: View;
  onView: (v: View) => void;
  connected: SystemStatus["api"];
}) {
  return (
    <nav
      className="flex w-12 shrink-0 flex-col items-center gap-2 border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] py-3"
      aria-label="Primary"
    >
      <RailIconButton
        active={view === "copilot"}
        onClick={() => onView("copilot")}
        label="Copilot"
        title="AI Copilot"
        glyph="⌁"
      />
      <RailIconButton label="Propose" title="Propose a trade" glyph="▣" />
      <RailIconButton label="Orders" title="Screened orders" glyph="☰" />
      <RailIconButton label="Market" title="Live market" glyph="◎" />

      <div className="mt-auto flex flex-col items-center gap-2">
        <div className="flex items-center gap-1.5" title={connected === "offline" ? "API unreachable" : "API connected"}>
          <span
            className={`lamp ${
              connected === "offline"
                ? "lamp-reject"
                : connected === "online"
                  ? "lamp-pass"
                  : "lamp-warn"
            }`}
            aria-hidden
          />
        </div>
      </div>
    </nav>
  );
}

function RailIconButton({
  active,
  onClick,
  label,
  title,
  glyph,
}: {
  active?: boolean;
  onClick?: () => void;
  label: string;
  title: string;
  glyph: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`nav-icon ${active ? "nav-icon-active" : ""}`}
      title={title}
      aria-label={label}
      aria-current={active ? "page" : undefined}
    >
      <span className="text-[15px] leading-none">{glyph}</span>
    </button>
  );
}

/* ---------------------------- Desk panel --------------------------- */
function DeskPanel({ api }: { api: SystemStatus["api"] }) {
  const [open, setOpen] = useState(() => window.innerWidth >= 1024);
  const live = api === "online";

  return (
    <>
      {/* Desktop fixed desk */}
      <aside className="hidden w-[340px] shrink-0 flex-col overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] lg:flex">
        <DeskHeader live={live} />
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

function DeskHeader({ live }: { live: boolean }) {
  return (
    <div className="band flex shrink-0 items-center justify-between px-3 py-2.5">
      <span className="label">Desk</span>
      <span className="sys-ind" title={live ? "Feeds connected" : "Feeds disconnected"}>
        <span className={`lamp ${live ? "lamp-pass" : "lamp-reject"}`} aria-hidden />
        <span className="val">{live ? "LIVE" : "OFFLINE"}</span>
      </span>
    </div>
  );
}

function DeskContent() {
  return (
    <div className="space-y-3 p-3">
      <MarketPrices />
      <OrdersPanel />
    </div>
  );
}
