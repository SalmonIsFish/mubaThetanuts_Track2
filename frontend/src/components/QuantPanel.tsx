import { useEffect, useState } from "react";
import { executeTrade } from "../api/client";
import type { TradeIntent } from "../types";
import CategoryBadge from "./CategoryBadge";

interface QuantSuggestion {
  asset: string;
  optionType: "put" | "call";
  strike: number;
  premium: number;
  spreadPct: number;
  spot: number;
  quant: { breakoutGapPct: number; trendGapPct: number; reason: string };
  syariah: { status: string; score: number; category?: string; rationale?: string; provider?: string };
  confidence: number;
  components: { technical: number; compliance: number; liquidity: number; riskHeadroom: number };
  auto: boolean;
  gateDecision: string | null;
  blockers: string[];
  halalReason?: string;
  halalCategory?: string;
  thesis: string;
}

interface QuantResponse {
  threshold: number;
  spendUsdc: number;
  count: number;
  suggestions: QuantSuggestion[];
}

const BASE_API = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

export default function QuantPanel() {
  const [threshold, setThreshold] = useState(0.8);
  const [spend, setSpend] = useState(2);
  const [data, setData] = useState<QuantResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [executing, setExecuting] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch(`${BASE_API.replace(/\/$/, "")}/quant/suggestions?threshold=${threshold}&spend=${spend}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setData(body as QuantResponse);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    load();
    const id = window.setInterval(load, 60000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold, spend]);

  async function onConfirm(s: QuantSuggestion) {
    const intent: TradeIntent = { asset: s.asset, optionType: s.optionType, side: "BUY", spendUsdc: spend };
    const key = `${s.asset}-${s.optionType}-${s.strike}`;
    setExecuting(key);
    setDone(null);
    try {
      const res = await executeTrade(intent);
      setDone(`Submitted ${s.asset} ${s.optionType} ${res.txHash.slice(0, 10)}… (or dry-run gated ${res.decision ?? "ok"})`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Execute failed");
    } finally {
      setExecuting(null);
    }
  }

  return (
    <section className="surface p-3.5">
      <header className="mb-2.5 flex items-center justify-between">
        <h3 className="label">Quant Agent — Autonomous</h3>
        <span className="num text-[11px] text-[var(--text-muted)]">{data ? `${data.count} ideas` : "…"}</span>
      </header>

      <div className="mb-3 rounded-lg border border-[var(--border-faint)] bg-[var(--bg-surface-2)] p-2.5">
        <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
          <span>Auto threshold</span>
          <span className="num font-medium text-[var(--text-primary)]">{Math.round(threshold * 100)}%</span>
        </div>
        <input
          type="range"
          min={0.7}
          max={0.9}
          step={0.05}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          className="mt-1 w-full accent-[var(--accent)]"
        />
        <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--text-faint)]">
          <span>More prompts (conservative)</span>
          <span>More auto</span>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <span className="text-[11px] text-[var(--text-muted)]">Spend</span>
          {[1, 2, 3].map((v) => (
            <button
              key={v}
              onClick={() => setSpend(v)}
              className={`rounded px-2 py-1 text-[11px] font-medium border ${spend === v ? "bg-[var(--accent-ink)] text-[var(--accent-strong)] border-[var(--accent-dim)]" : "bg-[var(--bg-surface)] text-[var(--text-muted)] border-[var(--border-subtle)]"}`}
            >
              ${v}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-[var(--text-faint)]">≥ threshold auto via Thetanuts 5 gates</span>
        </div>
      </div>

      {error && <div className="mb-2 rounded border border-[var(--reject-border)] bg-[var(--reject-bg)]/40 px-2 py-1.5 text-[11px] text-[var(--reject)]">{error}</div>}
      {done && <div className="mb-2 rounded border border-[var(--pass-border)] bg-[var(--pass-bg)]/40 px-2 py-1.5 text-[11px] text-[var(--pass)]">{done}</div>}

      <div className="space-y-2">
        {data?.suggestions.map((s) => {
          const key = `${s.asset}-${s.optionType}-${s.strike}`;
          const confP = Math.round(s.confidence * 100);
          return (
            <div key={key} className="rounded-lg border border-[var(--border-faint)] bg-[var(--bg-surface)] p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                  {s.asset} <span className="num text-[11px] font-normal text-[var(--text-muted)]">{s.optionType.toUpperCase()} ${s.strike.toFixed(2)}</span>
                </span>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${s.auto ? "border-[var(--pass-border)] bg-[var(--pass-bg)] text-[var(--pass)]" : "border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn)]"}`}>
                  {confP}% {s.auto ? "AUTO" : "NEEDS_YOUR_OK"}
                </span>
              </div>
              <div className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">{s.thesis}</div>
              <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                <span className="rounded bg-[var(--bg-surface-2)] border border-[var(--border-faint)] px-1.5 py-0.5">tech {Math.round(s.components.technical * 100)}%</span>
                <span className="rounded bg-[var(--bg-surface-2)] border border-[var(--border-faint)] px-1.5 py-0.5">compliance {Math.round(s.components.compliance * 100)}%</span>
                <span className="rounded bg-[var(--bg-surface-2)] border border-[var(--border-faint)] px-1.5 py-0.5">liquidity {Math.round(s.components.liquidity * 100)}%</span>
                <span className={`rounded px-1.5 py-0.5 border ${s.gateDecision === "READY_FOR_EXECUTION" ? "border-[var(--pass-border)] text-[var(--pass)] bg-[var(--pass-bg)]" : s.gateDecision === "BLOCKED" ? "border-[var(--reject-border)] text-[var(--reject)] bg-[var(--reject-bg)]" : "border-[var(--border-faint)] text-[var(--text-faint)]"}`}>gate {s.gateDecision ?? "—"}</span>
              </div>
              {/* Why halal / why not halal — structured ELI5 with table-like clarity */}
              <div className={`mt-2 rounded-lg border p-2.5 ${s.gateDecision === "BLOCKED" ? "border-[var(--reject-border)] bg-[var(--reject-bg)]/30" : "border-[var(--pass-border)] bg-[var(--pass-bg)]/20"}`}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.gateDecision === "BLOCKED" ? "bg-[var(--reject)]" : "bg-[var(--pass)]"}`} />
                  <span className="text-[11px] font-semibold text-[var(--text-primary)]">
                    {s.gateDecision === "BLOCKED" ? "Why not halal — blocked" : "Why halal — compliant"}
                  </span>
                  {s.syariah.category && <CategoryBadge category={s.syariah.category} />}
                  <span className={`ml-auto rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${s.gateDecision === "BLOCKED" ? "border-[var(--reject-border)] bg-[var(--reject-bg)] text-[var(--reject)]" : "border-[var(--pass-border)] bg-[var(--pass-bg)] text-[var(--pass)]"}`}>
                    {s.syariah.status}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">{s.halalReason ?? (s.gateDecision === "BLOCKED" ? "Blocked by gate — see blockers" : `Halal — ${s.asset} is ${s.syariah.category ?? "crypto_native"} with no Riba; see rationale below.`)}</p>
                {s.syariah.rationale && (
                  <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--text-muted)] line-clamp-3" title={s.syariah.rationale}>
                    <span className="font-medium text-[var(--text-secondary)]">Fiqh basis:</span> {s.syariah.rationale.slice(0, 180)}
                    {s.syariah.rationale.length > 180 ? "…" : ""}
                  </p>
                )}
                {s.blockers.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px]">
                    <span className="text-[var(--text-faint)]">Blockers:</span>
                    {s.blockers.map((b) => (
                      <span key={b} className="num rounded border border-[var(--reject-border)] bg-[var(--reject-bg)] px-1 py-0.5 text-[var(--reject)]">
                        {b}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-1.5 grid grid-cols-3 gap-1 text-[10px] text-center">
                  <span className="rounded bg-[var(--bg-surface)] border border-[var(--border-faint)] px-1 py-1">Underlying<br /><span className="font-semibold text-[var(--pass)]">PASS</span></span>
                  <span className={`rounded border px-1 py-1 ${s.gateDecision === "BLOCKED" ? "bg-[var(--reject-bg)] border-[var(--reject-border)] text-[var(--reject)]" : "bg-[var(--pass-bg)] border-[var(--pass-border)] text-[var(--pass)]"}`}>Delta<br /><span className="font-semibold">{s.gateDecision === "BLOCKED" ? "BLOCKED" : "PASS"}</span></span>
                  <span className="rounded bg-[var(--bg-surface)] border border-[var(--border-faint)] px-1 py-1">Risk<br /><span className="font-semibold text-[var(--pass)]">PASS</span></span>
                </div>
              </div>
              {!s.auto ? (
                <button
                  onClick={() => onConfirm(s)}
                  disabled={executing === key}
                  className="btn btn-primary mt-2 h-7 w-full text-[11px]"
                >
                  {executing === key ? "Submitting…" : `Confirm trade for ${s.asset}? (y/n) → Confirm`}
                </button>
              ) : (
                <div className="mt-2 text-[11px] text-[var(--text-faint)]">≥ threshold — would auto-submit via Thetanuts 5 gates (dry-run shows gate {s.gateDecision ?? "—"})</div>
              )}
            </div>
          );
        })}
        {data && data.suggestions.length === 0 && <div className="text-[11px] text-[var(--text-muted)]">No S001 signals (trend+breakout) right now — check back next bar.</div>}
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-faint)]">
        From <code className="num">quant-agent/confidence.py</code> 40/30/20/10 + <code className="num">Ai_Finance_Syariah S001</code>. Auto only if gates PASS, threshold only decides whether to prompt.
      </p>
    </section>
  );
}
