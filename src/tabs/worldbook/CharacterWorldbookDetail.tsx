import React from "react";
import { ArrowLeft, Plus, Search, X } from "lucide-react";
import EntriesGrid from "./EntriesGrid";
import InlineEntryForm from "./InlineEntryForm";
import type { EntriesGridProps } from "./EntriesGrid";
import type { InlineEntryFormProps } from "./InlineEntryForm";

export interface CharacterWorldbookDetailProps {
  title: string;
  subtitle: string;
  creatorTitle: React.ReactNode;
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  editingId: string | null;
  onBack: () => void;
  onStartNewInlineEntry: () => void;
  onCancelCreator: () => void;
  entriesGridProps: EntriesGridProps;
  inlineEntryFormProps: InlineEntryFormProps;
}

/**
 * 角色 / 自定义设定集详情视图。
 *
 * 对应原 GlobalWorldbookTab 中 `else` 分支（非 global、非 list）：
 * 渲染返回栏、控制面板（搜索框 + 新建按钮）、内联创建槽与条目网格。
 */
export default function CharacterWorldbookDetail({
  title,
  subtitle,
  creatorTitle,
  searchQuery,
  setSearchQuery,
  editingId,
  onBack,
  onStartNewInlineEntry,
  onCancelCreator,
  entriesGridProps,
  inlineEntryFormProps,
}: CharacterWorldbookDetailProps) {
  return (
    <div className="space-y-4 animate-fadeIn">
      {/* 返回栏 + 标题 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-border/50 pb-3 gap-2 select-none">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 h-7 px-2.5 bg-muted hover:bg-muted/80 text-foreground text-[11px] font-bold rounded-lg border border-border/50 transition active:scale-[0.96]"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>返回目录</span>
          </button>

          <div className="h-4 w-[1px] bg-border/60 hidden sm:block" />

          <div className="flex flex-col">
            <p className="text-xs font-extrabold text-foreground flex items-center gap-1 leading-snug">
              <span className="w-1.5 h-1.5 rounded-full bg-foreground/70 animate-pulse" />
              <span>{title}</span>
            </p>
            <p className="text-[9px] text-muted-foreground font-light">
              {subtitle}
            </p>
          </div>
        </div>
      </div>

      {/* 控制面板：搜索框 + 新建按钮 */}
      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-muted-foreground" />
          <input
            type="text"
            placeholder={`在此专属柜内检索关键字、回复词、具体内容...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-input border border-border rounded-lg pl-8 p-1.5 outline-none focus:border-primary text-xs text-foreground font-medium"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-2 text-muted-foreground hover:text-foreground text-[10px]"
            >
              清除
            </button>
          )}
        </div>

        {editingId !== "new_inline_temp_creator" && (
          <button
            onClick={onStartNewInlineEntry}
            className="bg-primary hover:bg-primary/95 text-primary-foreground px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition active:scale-[0.98] shadow-sm select-none"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>添加特定记忆</span>
          </button>
        )}
      </div>

      {/* 内联创建槽 */}
      {editingId === "new_inline_temp_creator" && (
        <div className="bg-card p-4 rounded-xl border border-primary/40 text-xs animate-fadeIn space-y-3 shadow-md">
          <div className="flex items-center justify-between border-b border-border/60 pb-1.5">
            <p className="font-bold text-primary flex items-center gap-1">
              {creatorTitle}
            </p>
            <button
              onClick={onCancelCreator}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <InlineEntryForm {...inlineEntryFormProps} />
        </div>
      )}

      {/* 条目网格 */}
      <EntriesGrid {...entriesGridProps} />
    </div>
  );
}
