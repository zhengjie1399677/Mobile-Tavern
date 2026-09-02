import { Switch } from "../../../components/ui/switch";

interface SettingsToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  badge?: string;
  tone?: "default" | "warning" | "danger";
  disabled?: boolean;
}

export default function SettingsToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
  badge,
  tone = "default",
  disabled = false,
}: SettingsToggleRowProps) {
  const badgeClass = tone === "warning"
    ? "settings-toggle-badge settings-toggle-badge-warning"
    : tone === "danger"
      ? "settings-toggle-badge settings-toggle-badge-danger"
      : "settings-toggle-badge";

  return (
    <div
      className="settings-toggle-row"
      data-enabled={checked ? "true" : "false"}
      data-disabled={disabled ? "true" : "false"}
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs sm:text-[13px] font-semibold text-foreground leading-tight">{label}</label>
          {badge && <span className={badgeClass}>{badge}</span>}
        </div>
        <p className="text-[10.5px] leading-normal text-muted-foreground/75">{description}</p>
      </div>
      <Switch
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        className="settings-toggle-switch"
      />
    </div>
  );
}
