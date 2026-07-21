import React from "react";
import { Archive, Book, Upload, Plus } from "lucide-react";
import { useTranslation } from "../../contexts/LanguageContext";

export interface WorldbookHeaderProps {
  activeHostId: string;
  showCustomAlert: (message: string, title?: string) => Promise<void>;
  onImportLorebookJSON: (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => Promise<void>;
  onExportLorebookJSON: () => Promise<void>;
  onCreateCustomWorldbook?: () => Promise<void>;
}

/**
 * 世界设定集顶部持久 Header。
 *
 * 始终展示标题「世界设定集」与全局导入 / 导出按钮。
 * 导出按钮在 list 视图下会拦截并提示用户先进入某个记忆回路。
 */
export default function WorldbookHeader({
  activeHostId,
  showCustomAlert,
  onImportLorebookJSON,
  onExportLorebookJSON,
  onCreateCustomWorldbook,
}: WorldbookHeaderProps) {
  const { t } = useTranslation();
  return (
    <div className="min-h-12 border-b border-border/80 pb-2 mb-2 shrink-0 flex items-center justify-between select-none">
      <div>
        <h1 className="text-base font-extrabold flex items-center gap-1.5 text-foreground tracking-tight">
          <Book className="w-4 h-4 text-primary" /> {t("worldbook.title")}
        </h1>
        <p className="text-[10px] text-muted-foreground mt-0.5 font-light">
          {t("worldbook.subtitle")}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {activeHostId === "list" && onCreateCustomWorldbook && (
          <button
            type="button"
            onClick={onCreateCustomWorldbook}
            className="bg-card hover:bg-muted/40 border border-border text-[11px] text-foreground h-7 px-2.5 rounded-lg transition font-bold flex items-center gap-1 shadow-sm active:scale-[0.98]"
          >
            <Plus className="w-3 h-3 text-primary" />
            <span>{t("worldbook.new")}</span>
          </button>
        )}
        <label className="cursor-pointer bg-card hover:bg-muted/40 border border-border text-[11px] text-foreground h-7 px-2.5 rounded-lg transition font-bold flex items-center gap-1 shadow-sm active:scale-[0.98]">
          <Upload className="w-3 h-3 text-primary" />
          <span>{t("worldbook.import")}</span>
          <input
            type="file"
            onChange={onImportLorebookJSON}
            accept=".json,.txt,.bin,application/json,text/plain"
            className="hidden"
          />
        </label>
        <button
          type="button"
          onClick={async (e) => {
            if (activeHostId === "list") {
              e.preventDefault();
              await showCustomAlert(
                t("worldbook.export_alert"),
              );
            } else {
              await onExportLorebookJSON();
            }
          }}
          className="bg-card hover:bg-muted/40 border border-border text-[11px] text-foreground h-7 px-2.5 rounded-lg transition font-bold flex items-center gap-1 shadow-sm active:scale-[0.98]"
        >
          <Archive className="w-3 h-3 text-primary" />
          <span>{t("worldbook.export")}</span>
        </button>
      </div>
    </div>
  );
}
