import type { ExecuteResponse } from "../types";
import { fmtAddress as fmtAddr, fmtNum } from "../lib/format";

interface Props {
  result: ExecuteResponse;
}

export default function ExecutionReceipt({ result }: Props) {
  return (
    <div className="surface p-4 space-y-4">
      <div className="flex items-center justify-between">
        <span className="label">Execution</span>
        <span className="state-badge state-pass">
          <span aria-hidden>✓</span> Broadcast
        </span>
      </div>

      <div className="rounded-lg border border-[var(--border-faint)] bg-[var(--bg-surface-2)] p-4 space-y-2">
        <Row label="Transaction">
          <a
            href={result.basescanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="num text-[var(--accent-strong)] hover:underline font-medium"
          >
            {shortHash(result.txHash)}
          </a>
        </Row>
        <Row label="Account">
          <span className="num text-[var(--text-secondary)]">{fmtAddr(result.account, 8)}</span>
        </Row>
        <Row label="Contracts Filled">
          <span className="num text-[var(--text-primary)]">
            {fmtNum(result.numContractsFilledHuman, 6)}
          </span>
        </Row>
        <Row label="Decision">
          <span className="text-[var(--pass)]">READY_FOR_EXECUTION</span>
        </Row>
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        View the full transaction on{" "}
        <a
          href={result.basescanUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--accent-strong)] hover:underline"
        >
          Basescan
        </a>{" "}
        (Base mainnet).
      </p>
    </div>
  );
}

function shortHash(hash: string): string {
  if (!hash) return "—";
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="label">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
