import type { CustomThemePackage } from "../../utils/themePackage";
import { ContrastSummary } from "./ContrastSummary";

const CORE_COLORS = [
  { key: "--background", label: "页面背景" },
  { key: "--card", label: "内容表面" },
  { key: "--foreground", label: "主要文字" },
  { key: "--primary", label: "强调色" },
  { key: "--border", label: "边框" },
] as const;

const ADVANCED_COLOR_GROUPS = [
  { title: "页面与表面", variables: ["--popover", "--input", "--muted"] },
  {
    title: "文字与操作",
    variables: [
      "--card-foreground", "--popover-foreground", "--primary-foreground", "--secondary",
      "--secondary-foreground", "--muted-foreground", "--accent", "--accent-foreground",
    ],
  },
  {
    title: "状态与长文本",
    variables: [
      "--ring", "--destructive", "--destructive-foreground", "--dialogue-color", "--prose-color",
    ],
  },
] as const;

const COLOR_LABELS: Record<string, string> = {
  "--popover": "弹出层", "--input": "输入框", "--muted": "弱化表面",
  "--card-foreground": "表面文字", "--popover-foreground": "弹出层文字",
  "--primary-foreground": "强调色文字", "--secondary": "次要操作",
  "--secondary-foreground": "次要操作文字", "--muted-foreground": "弱化文字",
  "--accent": "悬停强调", "--accent-foreground": "悬停强调文字", "--ring": "焦点环",
  "--destructive": "危险操作", "--destructive-foreground": "危险操作文字",
  "--dialogue-color": "对白文字", "--prose-color": "旁白文字",
};

function normalizeColorPickerValue(value: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed.slice(1).split("").map(part => `${part}${part}`).join("")}`;
  }
  return "#ffffff";
}

export function ColorsSection({
  theme,
  updateVariable,
}: {
  theme: CustomThemePackage;
  updateVariable: (key: string, value: string) => void;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h2 className="text-sm font-bold">核心颜色</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">颜色选择器使用 Hex；文本框仍可保留其他合法 CSS 颜色值。</p>
      </div>
      <div className="divide-y divide-border rounded-xl border border-border bg-card px-3">
        {CORE_COLORS.map(item => (
          <ColorRow
            key={item.key}
            label={item.label}
            variable={item.key}
            value={theme.variables[item.key] ?? ""}
            onChange={updateVariable}
          />
        ))}
      </div>

      <ContrastSummary variables={theme.variables} />

      <details className="rounded-xl border border-border bg-card p-3">
        <summary className="cursor-pointer text-xs font-bold">高级语义颜色</summary>
        <div className="mt-3 space-y-4">
          {ADVANCED_COLOR_GROUPS.map(group => (
            <section key={group.title}>
              <h3 className="mb-1.5 text-[11px] font-bold text-muted-foreground">{group.title}</h3>
              <div className="divide-y divide-border">
                {group.variables.map(variable => (
                  <ColorRow
                    key={variable}
                    label={COLOR_LABELS[variable] ?? variable}
                    variable={variable}
                    value={theme.variables[variable] ?? ""}
                    onChange={updateVariable}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </details>
    </div>
  );
}

function ColorRow({
  label,
  variable,
  value,
  onChange,
}: {
  label: string;
  variable: string;
  value: string;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-foreground">{label}</span>
        <span className="block truncate font-mono text-[10px] text-muted-foreground">{variable}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <input
          type="color"
          aria-label={`${label}颜色选择器`}
          value={normalizeColorPickerValue(value)}
          onChange={event => onChange(variable, event.target.value)}
          className="size-8 cursor-pointer rounded-lg border border-border bg-transparent p-0.5"
        />
        <input
          value={value}
          onChange={event => onChange(variable, event.target.value)}
          className="h-8 w-28 rounded-lg border border-border bg-input px-2 font-mono text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
    </div>
  );
}
