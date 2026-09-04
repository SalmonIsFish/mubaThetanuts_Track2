interface CategoryMeta {
  label: string;
  color: string;
  bg: string;
  border: string;
}

// Mirrors gate-chain/data/crypto-underlying-universe.json's own taxonomy
// (docs/RWA_AND_CATEGORIES.md) -- this is real screened data, not a
// decorative label. rwa_debt gets a struck-through treatment: it's hard-
// rejected in code (HARD_REJECT_CATEGORIES in underlying_screen.py), not
// just flagged, so the badge should read as "structurally excluded."
const CATEGORY_META: Record<string, CategoryMeta> = {
  crypto_native: { label: "Crypto-Native", color: "var(--cat-crypto)", bg: "var(--cat-crypto-bg)", border: "var(--cat-crypto-border)" },
  stablecoin: { label: "Stablecoin", color: "var(--cat-stable)", bg: "var(--cat-stable-bg)", border: "var(--cat-stable-border)" },
  rwa_commodity: { label: "RWA · Commodity", color: "var(--cat-gold)", bg: "var(--cat-gold-bg)", border: "var(--cat-gold-border)" },
  rwa_real_estate: { label: "RWA · Real Estate", color: "var(--cat-clay)", bg: "var(--cat-clay-bg)", border: "var(--cat-clay-border)" },
  rwa_equity: { label: "RWA · Equity", color: "var(--cat-violet)", bg: "var(--cat-violet-bg)", border: "var(--cat-violet-border)" },
  rwa_debt: { label: "RWA · Debt", color: "var(--cat-debt)", bg: "var(--cat-debt-bg)", border: "var(--cat-debt-border)" },
};

export default function CategoryBadge({ category }: { category?: string | null }) {
  if (!category) return null;
  const meta = CATEGORY_META[category] ?? {
    label: category.replace(/_/g, " "),
    color: "var(--text-muted)",
    bg: "var(--bg-surface-2)",
    border: "var(--border-subtle)",
  };
  const structurallyExcluded = category === "rwa_debt";

  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide border"
      style={{
        color: meta.color,
        background: meta.bg,
        borderColor: meta.border,
        textDecoration: structurallyExcluded ? "line-through" : undefined,
        textDecorationColor: structurallyExcluded ? meta.color : undefined,
      }}
      title={structurallyExcluded ? "Hard-rejected in code — interest-bearing by construction" : undefined}
    >
      {meta.label}
    </span>
  );
}
