import React from "react";
import { Archive, Book, Upload } from "lucide-react";

export interface WorldbookHeaderProps {
  activeHostId: string;
  showCustomAlert: (message: string, title?: string) => Promise<void>;
  onImportLorebookJSON: (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => Promise<void>;
  onExportLorebookJSON: () => Promise<void>;
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
}: WorldbookHeaderProps) {
  return (
    <div className="border-b border-border/80 pb-3 mb-2 shrink-0 flex items-center justify-between select-none">
      <div>
        <h1 className="text-sm font-extrabold flex items-center gap-1.5 text-foreground tracking-tight">
          <Book className="w-4 h-4 text-primary" /> 世界设定集
        </h1>
        <p className="text-[10px] text-muted-foreground mt-0.5 font-light">
          专属宿体隔离 / 全局常驻共享
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <label className="cursor-pointer bg-card hover:bg-muted/40 border border-border text-[11px] text-foreground h-7 px-2.5 rounded-lg transition font-bold flex items-center gap-1 shadow-sm active:scale-[0.98]">
          <Upload className="w-3 h-3 text-primary" />
          <span>导入</span>
          <input
            type="file"
            onChange={onImportLorebookJSON}
            accept=".json"
            className="hidden"
          />
        </label>
        <button
          type="button"
          onClick={async (e) => {
            if (activeHostId === "list") {
              e.preventDefault();
              await showCustomAlert(
                "请先点击进入一个记忆回路（全局或角色），再进行导出。",
              );
            } else {
              await onExportLorebookJSON();
            }
          }}
          className="bg-card hover:bg-muted/40 border border-border text-[11px] text-foreground h-7 px-2.5 rounded-lg transition font-bold flex items-center gap-1 shadow-sm active:scale-[0.98]"
        >
          <Archive className="w-3 h-3 text-primary" />
          <span>导出</span>
        </button>
      </div>
    </div>
  );
}
