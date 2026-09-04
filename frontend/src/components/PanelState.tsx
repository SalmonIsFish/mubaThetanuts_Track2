interface Props {
  icon?: string;
  title: string;
  detail?: string;
  retry?: "auto" | "manual";
}

/**
 * Professional empty / unavailable state for desk panels.
 * Replaces raw error strings and bare "nothing here" text.
 */
export default function PanelState({
  icon = "—",
  title,
  detail,
  retry,
}: Props) {
  return (
    <div className="panel-state">
      <div className="ps-icon" aria-hidden>
        {icon}
      </div>
      <div className="ps-title">{title}</div>
      {detail && <div className="ps-detail">{detail}</div>}
      {retry && (
        <div className={`ps-retry ${retry === "auto" ? "online" : "off"}`}>
          {retry === "auto" ? "Retrying automatically" : ""}
        </div>
      )}
    </div>
  );
}
