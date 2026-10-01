import { useState } from "react";
import { Server, Download, Upload, ChevronDown, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "../../../contexts/LanguageContext";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../../../../components/ui/card";
import SettingsToggleRow from "../SettingsToggleRow";
import type { HostBindingSettings } from "../../../types";
import type { UnifiedAppContextProps } from "../../../UnifiedAppContext";

export type HostSyncCardProps = Pick<UnifiedAppContextProps,
  | "settings"
  | "updateSettings"
  | "backupStatus"
  | "handlePushToHost"
  | "handlePullFromHost"
> & {
  /** 未配置宿主时引导前往「宿主与互联」分区。 */
  onNavigateToHost?: () => void;
};

type HostSyncMode = NonNullable<HostBindingSettings["syncMode"]>;

/**
 * 宿主同步卡片。
 *
 * 两种语义必须在界面上显式可选、并各自写清后果，因为「合并」与「覆盖」是同步这件事
 * 唯一的危险分界：合并求并集、两端独有内容都保留；覆盖是后写者生效、会抹掉另一端
 * 独有的数据。默认取合并 —— 覆盖属于要主动选择的破坏性操作，不该是默认行为。
 *
 * 「同步前显示合并预览与确认」放在高级选项里：关闭后同步直接执行（仍会留存安全快照），
 * 代价是失去落库前查看「将新增/更新/删除什么」的机会，因此不放在首屏。
 */
export default function HostSyncCard({
  settings,
  updateSettings,
  backupStatus,
  handlePushToHost,
  handlePullFromHost,
  onNavigateToHost,
}: HostSyncCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState<"push" | "pull" | null>(null);

  const remoteUrl = (settings.hostBinding?.remoteUrl || "").trim();
  const configured = Boolean(remoteUrl);
  // 旧版本设置里没有这两个字段，缺省即「合并 + 预览」，与 DEFAULT_SETTINGS 保持一致。
  const mode: HostSyncMode = settings.hostBinding?.syncMode === "replace" ? "replace" : "merge";
  const previewEnabled = settings.hostBinding?.syncPreviewEnabled !== false;

  const toggleIconClass = `w-3.5 h-3.5 transition-transform duration-200 ${
    expanded ? "rotate-180" : ""
  }`;

  /**
   * 只改这两个同步开关，不在这里重建整份 hostBinding。
   *
   * 其余字段（监听地址、端口、凭据）的默认值归「宿主与互联」分区所有，在同步卡片里
   * 再定义一套回落会让同一份配置出现两个真相来源。`useSettingsLoader` 已保证设置对象
   * 带全字段，因此缺失时直接不动设置，而不是凭猜测补一个半成品。
   */
  const patchSync = (patch: Pick<HostBindingSettings, "syncMode" | "syncPreviewEnabled">) => {
    updateSettings((prev) => {
      const binding = prev.hostBinding;
      if (!binding) return prev;
      return { ...prev, hostBinding: { ...binding, ...patch } };
    });
  };

  const run = async (direction: "push" | "pull") => {
    if (busy) return;
    setBusy(direction);
    try {
      if (direction === "push") {
        await handlePushToHost();
      } else {
        await handlePullFromHost();
      }
    } finally {
      setBusy(null);
    }
  };

  const actionClass =
    "h-8.5 rounded-xl bg-background hover:bg-muted border border-border shadow-2xs text-foreground text-xs font-semibold transition flex justify-center items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-background active:scale-95";

  const modeTabClass = (active: boolean) =>
    `flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
      active
        ? "bg-background text-foreground shadow-2xs ring-1 ring-border/60"
        : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <Card className="bg-card border-border shadow-sm mt-2">
      <CardHeader
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        className="py-2.5 px-3 cursor-pointer hover:bg-muted/50 transition-colors border-b border-border/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={() => setExpanded((value) => !value)}
        onKeyDown={(event) => {
          // 折叠头是可交互控件，键盘必须能用；否则键盘用户进不了这张卡片。
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setExpanded((value) => !value);
          }
        }}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs sm:text-[13px] flex items-center gap-2 font-bold text-foreground">
            <Server className="w-4 h-4 text-sky-500" />{" "}
            {t("host_sync.title")}
            <span
              className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-md ${
                mode === "merge"
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
              }`}
            >
              {mode === "merge" ? t("host_sync.mode_merge") : t("host_sync.mode_replace")}
            </span>
          </CardTitle>
          <span className="text-muted-foreground text-[11px] font-medium flex items-center gap-1">
            {expanded ? t("backup.collapse") : t("backup.expand")}
            <ChevronDown aria-hidden="true" className={toggleIconClass} />
          </span>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-3 px-3 pb-3 space-y-3 bg-muted/10 animate-in fade-in slide-in-from-top-2 duration-300">
          <p className="text-[11px] leading-relaxed text-muted-foreground/80">
            {t("host_sync.desc")}
          </p>

          <div className="rounded-lg border border-border/50 bg-background/70 p-2 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-foreground shrink-0">
                {t("host_sync.target_label")}
              </span>
              <span
                className={`text-[11px] font-mono truncate ${
                  configured ? "text-foreground" : "text-muted-foreground/70"
                }`}
              >
                {configured ? remoteUrl : t("host_sync.not_configured")}
              </span>
            </div>
            {!configured && onNavigateToHost && (
              <button
                onClick={onNavigateToHost}
                className="w-full mt-1 h-8 rounded-xl border border-border bg-background hover:bg-muted text-xs font-semibold text-foreground transition active:scale-95 shadow-2xs flex items-center justify-center"
              >
                {t("host_sync.go_to_settings")}
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-foreground">
              {t("host_sync.mode_label")}
            </span>
            <div
              role="group"
              aria-label={t("host_sync.mode_label")}
              className="flex gap-1 rounded-lg bg-muted/60 p-1 border border-border/50"
            >
              <button
                type="button"
                aria-pressed={mode === "merge"}
                onClick={() => patchSync({ syncMode: "merge" })}
                className={modeTabClass(mode === "merge")}
              >
                {t("host_sync.mode_merge")}
              </button>
              <button
                type="button"
                aria-pressed={mode === "replace"}
                onClick={() => patchSync({ syncMode: "replace" })}
                className={modeTabClass(mode === "replace")}
              >
                {t("host_sync.mode_replace")}
              </button>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground/80">
              {mode === "merge"
                ? t("host_sync.mode_merge_hint")
                : t("host_sync.mode_replace_hint")}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              disabled={!configured || busy !== null}
              onClick={() => void run("push")}
              className={actionClass}
            >
              <Upload className="w-3.5 h-3.5 text-sky-500" />{" "}
              {busy === "push" ? t("host_sync.pushing") : t("host_sync.push_btn")}
            </button>
            <button
              disabled={!configured || busy !== null}
              onClick={() => void run("pull")}
              className={actionClass}
            >
              <Download className="w-3.5 h-3.5 text-emerald-500" />{" "}
              {busy === "pull" ? t("host_sync.pulling") : t("host_sync.pull_btn")}
            </button>
          </div>

          <p
            className={`text-[11px] leading-relaxed ${
              mode === "merge"
                ? "text-muted-foreground/80"
                : "text-amber-600 dark:text-amber-400"
            }`}
          >
            {mode === "merge"
              ? t("host_sync.merge_warning")
              : t("host_sync.overwrite_warning")}
          </p>

          <div className="rounded-lg border border-border/50 bg-background/70 overflow-hidden">
            <button
              type="button"
              aria-expanded={showAdvanced}
              onClick={() => setShowAdvanced((value) => !value)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted/40 transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <SlidersHorizontal className="w-3 h-3" aria-hidden="true" />
                {t("host_sync.advanced_label")}
              </span>
              <ChevronDown
                aria-hidden="true"
                className={`w-3 h-3 transition-transform duration-200 ${
                  showAdvanced ? "rotate-180" : ""
                }`}
              />
            </button>
            {showAdvanced && (
              <div className="px-2.5 pb-2.5 pt-1.5 border-t border-border/40 space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
                <SettingsToggleRow
                  label={t("host_sync.preview_toggle")}
                  description={t("host_sync.preview_toggle_desc")}
                  checked={previewEnabled}
                  onCheckedChange={(checked) => patchSync({ syncPreviewEnabled: checked })}
                />
                {!previewEnabled && (
                  <p className="text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
                    {t("host_sync.preview_off_hint")}
                  </p>
                )}
              </div>
            )}
          </div>

          {backupStatus && (
            <div className="bg-background border border-border rounded-xl p-2.5 text-[11px] text-muted-foreground text-center font-mono animate-in fade-in zoom-in-95 duration-200">
              {backupStatus}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
