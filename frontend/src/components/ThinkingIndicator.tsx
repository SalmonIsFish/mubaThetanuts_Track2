import { useEffect, useState } from "react";

const STAGES = [
  { label: "Understanding request", detail: "Parsing asset, direction, and amount" },
  { label: "Resolving market data", detail: "Fetching live option orders & prices" },
  { label: "Running Shariah / risk gates", detail: "Evaluating via deterministic gate chain" },
];

export default function ThinkingIndicator() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 900);
    const t2 = setTimeout(() => setStep(2), 1900);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  return (
    <div className="flex gap-3">
      <div className="mt-0.5 h-7 w-7 shrink-0 rounded-md border border-[var(--accent-dim)] bg-[var(--accent-ink)] text-[var(--accent-strong)] flex items-center justify-center text-[13px] font-semibold opacity-80">
        ⚖
      </div>
      <div className="flex-1 max-w-[420px] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-3">
        {STAGES.map((s, i) => {
          const isActive = i === step;
          const isDone = i < step;
          return (
            <div key={s.label} className="flex items-start gap-3">
              <div className="mt-0.5 h-5 w-5 shrink-0 flex items-center justify-center">
                {isDone ? (
                  <span className="text-[var(--pass)] text-[13px] leading-none">✓</span>
                ) : isActive ? (
                  <span className="h-3 w-3 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin block" />
                ) : (
                  <span className="h-3 w-3 rounded-full border border-[var(--border-strong)] block" />
                )}
              </div>
              <div className="min-w-0">
                <div
                  className={`text-[13px] font-medium ${
                    isActive
                      ? "text-[var(--text-primary)]"
                      : isDone
                        ? "text-[var(--text-secondary)]"
                        : "text-[var(--text-faint)]"
                  }`}
                >
                  {s.label}
                </div>
                <div className="text-[11px] text-[var(--text-faint)]">{s.detail}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
