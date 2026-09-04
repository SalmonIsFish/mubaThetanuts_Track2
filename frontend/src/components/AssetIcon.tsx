interface Props {
  asset: string;
  size?: number;
  className?: string;
}

/**
 * Original, simplified glyphs — not traced brand marks. Background colors
 * follow the industry-standard association for each asset (BTC orange, ETH
 * slate, SOL's own violet-to-mint gradient); colors aren't copyrightable and
 * every crypto product uses these same conventions.
 */
export default function AssetIcon({ asset, size = 20, className = "" }: Props) {
  const key = asset.toUpperCase();
  const style = { width: size, height: size };

  if (key === "BTC") {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${className}`}
        style={{ ...style, background: "#f7931a", color: "#1a1006", fontSize: size * 0.6 }}
        aria-hidden
      >
        ₿
      </span>
    );
  }

  if (key === "ETH") {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full ${className}`}
        style={{ ...style, background: "#3c3f58" }}
        aria-hidden
      >
        <svg width={size * 0.42} height={size * 0.52} viewBox="0 0 12 15" fill="none">
          <path d="M6 0 6 9 11.5 6.3Z" fill="#a8b0e0" />
          <path d="M6 0 0.5 6.3 6 9Z" fill="#e7ecf3" />
          <path d="M6 10.2 6 15 11.5 7.6Z" fill="#a8b0e0" />
          <path d="M6 15 6 10.2 0.5 7.6Z" fill="#e7ecf3" />
        </svg>
      </span>
    );
  }

  if (key === "SOL") {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full ${className}`}
        style={{ ...style, background: "linear-gradient(135deg, #9945ff, #14f195)" }}
        aria-hidden
      >
        <svg width={size * 0.52} height={size * 0.4} viewBox="0 0 14 10" fill="#0a0e14">
          <polygon points="2,1 14,1 12,3 0,3" />
          <polygon points="0,4.5 12,4.5 10,6.5 -2,6.5" />
          <polygon points="2,8 14,8 12,10 0,10" />
        </svg>
      </span>
    );
  }

  if (key === "AVAX") {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full ${className}`}
        style={{ ...style, background: "#e84142" }}
        aria-hidden
      >
        <svg width={size * 0.5} height={size * 0.46} viewBox="0 0 12 11" fill="none">
          <polygon points="6,0 12,11 0,11" fill="#1a0606" />
          <polygon points="6,3.4 9.6,10 2.4,10" fill="#e84142" />
        </svg>
      </span>
    );
  }

  if (key === "BNB") {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full ${className}`}
        style={{ ...style, background: "#f0b90b" }}
        aria-hidden
      >
        <svg width={size * 0.42} height={size * 0.42} viewBox="0 0 10 10" fill="#1a1503">
          <rect x="1.5" y="1.5" width="7" height="7" transform="rotate(45 5 5)" />
        </svg>
      </span>
    );
  }

  if (key === "XRP") {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${className}`}
        style={{ ...style, background: "#0a1c3d", color: "#6690ff", fontSize: size * 0.5 }}
        aria-hidden
      >
        X
      </span>
    );
  }

  if (key === "DOGE") {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${className}`}
        style={{ ...style, background: "#c2a633", color: "#1a1500", fontSize: size * 0.52 }}
        aria-hidden
      >
        Ð
      </span>
    );
  }

  if (key === "PAXG") {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${className}`}
        style={{ ...style, background: "#d4a54a", color: "#1a1200", fontSize: size * 0.5 }}
        aria-hidden
      >
        Au
      </span>
    );
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] text-[var(--text-secondary)] font-semibold ${className}`}
      style={{ ...style, fontSize: size * 0.5 }}
      aria-hidden
    >
      {key.charAt(0)}
    </span>
  );
}
