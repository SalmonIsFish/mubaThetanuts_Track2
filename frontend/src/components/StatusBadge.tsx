type StatusKind = "pass" | "reject" | "warn" | "info";

interface Props {
  kind: StatusKind;
  label: string;
  icon?: string;
  title?: string;
}

/** State badge — always icon + text, never color alone. */
export default function StatusBadge({ kind, label, icon, title }: Props) {
  const glyph =
    icon ??
    (kind === "pass"
      ? "✓"
      : kind === "reject"
        ? "✕"
        : kind === "warn"
          ? "!"
          : "i");

  return (
    <span
      className={`state-badge state-${kind}`}
      title={title}
      role="status"
    >
      <span aria-hidden className="text-[10px] leading-none">{glyph}</span>
      {label}
    </span>
  );
}
