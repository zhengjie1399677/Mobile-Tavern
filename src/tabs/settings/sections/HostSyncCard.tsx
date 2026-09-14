import { useState } from "react";
import { Server, Download, Upload, ChevronDown } from "lucide-react";
import { useTranslation } from "../../../contexts/LanguageContext";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../../../../components/ui/card";
import type { UnifiedAppContextProps } from "../../../UnifiedAppContext";

export type HostSyncCardProps = Pick<UnifiedAppContextProps,
  | "settings"
  | "backupStatus"
  | "handlePushToHost"
  | "handlePullFromHost"
> & {
  /** 未配置宿主时引导前往「宿主与互联」分区。 */
  onNavigateToHost?: () => void;
};

/**
 * 宿主同步卡片（覆盖式）。
 *
 * 这里必须把「覆盖式、后写者生效」写在界面上：这是本功能与普通备份唯一的区别，
 * 也是用户最容易误判的地方。设置不跨设备覆盖（API Key 不传输）的约束由用例层保证。
 */
export default function HostSyncCard({
  settings,
  backupStatus,
  handlePushToHost,
  handlePullFromHost,
  onNavigateToHost,
}: HostSyncCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<"push" | "pull" | null>(null);

  const remoteUrl = (settings.hostBinding?.remoteUrl || "").trim();
  const configured = Boolean(remoteUrl);
  const toggleIconClass = `w-3.5 h-3.5 transition-transform duration-200 ${
    expanded ? "rotate-180" : ""
  }`;

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
    "bg-background hover:bg-muted border border-border shadow-sm text-foreground py-2 rounded-md transition flex justify-center items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-background";

  return (
    <Card className="bg-card border-border shadow-sm mt-2">
      <CardHeader
        className="py-2.5 px-3 cursor-pointer hover:bg-muted/50 transition-colors border-b border-border/40"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2 font-semibold text-foreground">
            <Server className="w-4 h-4 text-sky-500" />{" "}
            {t("host_sync.title")}
          </CardTitle>
          <span className="text-muted-foreground text-[10px] flex items-center gap-1">
            {expanded ? t("backup.collapse") : t("backup.expand")}
            <ChevronDown aria-hidden="true" className={toggleIconClass} />
          </span>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-3 px-3 pb-3 space-y-3 bg-muted/10 animate-in fade-in slide-in-from-top-2 duration-300">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("host_sync.desc")}
          </p>

          <div className="rounded-lg border border-border/50 bg-background/70 p-2 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold text-muted-foreground shrink-0">
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
                className="w-full mt-1 rounded-md border border-border bg-background hover:bg-muted py-1.5 text-[11px] font-bold text-foreground transition"
              >
                {t("host_sync.go_to_settings")}
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs font-bold">
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

          <p className="text-[10px] leading-relaxed text-amber-600 dark:text-amber-400">
            {t("host_sync.overwrite_warning")}
          </p>

          {backupStatus && (
            <div className="bg-background border border-border rounded p-2 text-[10px] text-muted-foreground text-center font-mono animate-in fade-in zoom-in-95 duration-200">
              {backupStatus}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
