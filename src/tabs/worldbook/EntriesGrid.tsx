import React from "react";
import {
  ChevronDown,
  ChevronUp,
  Edit2,
  Trash2,
  Hash,
  Sparkles,
} from "lucide-react";
import { LorebookEntry } from "../../types";
import InlineEntryForm from "./InlineEntryForm";
import type { EditFormState } from "./useWorldbookActions";

export interface EntriesGridProps {
  filteredChildEntries: LorebookEntry[];
  expandedEntryIds: Record<string, boolean>;
  editingId: string | null;
  activeHostId: string;
  editForm: EditFormState;
  setEditForm: React.Dispatch<React.SetStateAction<EditFormState>>;
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>;
  onToggleExpand: (id: string) => void;
  onStartInlineEdit: (entry: LorebookEntry) => void;
  onDeleteEntry: (entry: LorebookEntry) => Promise<void>;
  onSaveInlineEntry: (id: string) => Promise<void>;
}

/**
 * 世界设定条目网格组件。
 *
 * 对应原 GlobalWorldbookTab 内部 `renderEntriesGrid` 函数：
 * 渲染折叠头（标题 + 徽章 + 位置 / 深度 / 优先级 / 触发率元信息）与展开面板
 * （编辑 / 删除按钮、元信息网格、叙事内容块，或内联编辑表单）。
 */
export default function EntriesGrid({
  filteredChildEntries,
  expandedEntryIds,
  editingId,
  activeHostId,
  editForm,
  setEditForm,
  setEditingId,
  onToggleExpand,
  onStartInlineEdit,
  onDeleteEntry,
  onSaveInlineEntry,
}: EntriesGridProps) {
  return (
    <div className="space-y-2.5 animate-fadeIn">
      {filteredChildEntries.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border border-dashed border-border/80 rounded-xl italic text-xs bg-muted/5 space-y-2">
          <p>📭 暂未发现匹配的世界设定记录。</p>
          <p className="text-[10.5px] text-muted-foreground font-light max-w-sm mx-auto">
            当前分区柜为空白。您可以点击右上角按钮手工撰写新的设定。
          </p>
        </div>
      ) : (
        filteredChildEntries.map((entry) => {
          const isExpanded = !!expandedEntryIds[entry.id];
          const isEditingType = editingId === entry.id;
          const entryLabel =
            entry.comment ||
            (Array.isArray(entry.keys) && entry.keys.slice(0, 3).join(", ")) ||
            (typeof entry.keys === "string" && entry.keys) ||
            "未命名设定";
          const isEntryGlobal = activeHostId === "global";

          return (
            <div
              key={entry.id}
              className={`bg-card rounded-xl border text-xs transition-all duration-200 ${
                isEditingType
                  ? "border-primary ring-1 ring-primary/40 shadow-sm"
                  : entry.disabled
                    ? "border-dashed border-red-900/10 bg-red-950/2 opacity-60"
                    : isExpanded
                      ? "border-primary/30"
                      : "border-border/80 hover:border-border"
              }`}
            >
              {/* 折叠头 */}
              <div
                onClick={() => onToggleExpand(entry.id)}
                className="p-3 flex flex-col gap-2 cursor-pointer select-none"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-muted-foreground shrink-0 text-xs text-primary/70">
                      <Hash className="w-3.5 h-3.5" />
                    </span>
                    <span className="font-semibold text-foreground truncate text-[12.5px] flex-1 min-w-0">
                      {entryLabel}
                    </span>

                    {/* 徽章 */}
                    <div className="flex items-center gap-1 shrink-0 scale-90 flex-wrap">
                      {entry.constant && (
                        <span className="bg-amber-950/25 text-amber-500 border border-amber-900/15 px-1.5 py-0.2 rounded text-[9px]">
                          常驻
                        </span>
                      )}
                      {entry.disabled && (
                        <span className="bg-rose-950/25 text-rose-400 border border-rose-900/15 px-1.5 py-0.2 rounded text-[9px]">
                          禁用
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 仅 chevron，子级不再放置通用快捷开关 */}
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-primary hover:bg-primary/10 p-1.5 rounded-lg border border-border/50 transition-all duration-150 active:scale-90 flex items-center justify-center bg-muted/20 shrink-0 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleExpand(entry.id);
                    }}
                    title={isExpanded ? "收起" : "展开"}
                  >
                    {isExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>

                {/* 下方一行：位置 / 深度 / 优先级 / 触发率 */}
                <div
                  className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10.5px] font-bold leading-none ${
                    isEntryGlobal ? "text-primary" : "text-foreground"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isEntryGlobal
                        ? "bg-primary animate-pulse"
                        : "bg-foreground animate-pulse"
                    }`}
                  />
                  <span>
                    位置:{" "}
                    {entry.position === "after_char_def"
                      ? "📌角色后"
                      : entry.position === "before_char_def"
                        ? "📌角色前"
                        : entry.position === "top"
                          ? "📌最顶部"
                          : entry.position === "in_chat"
                            ? "💬历史层"
                            : "💬发言上"}
                  </span>
                  <span className="text-muted-foreground/35">|</span>
                  <span>插入深度: {entry.depth !== undefined ? entry.depth : 4}</span>
                  <span className="text-muted-foreground/35">|</span>
                  <span>
                    编排优先级: {entry.order !== undefined ? entry.order : 100}
                  </span>
                  <span className="text-muted-foreground/35">|</span>
                  <span>
                    触发率:{" "}
                    {entry.probability !== undefined ? entry.probability : 100}%
                  </span>
                  {entry.useRegex && (
                    <>
                      <span className="text-muted-foreground/35">|</span>
                      <span className="font-mono text-[9px] uppercase px-1 py-0.1 bg-current/10 rounded">
                        Regex
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* 展开面板 */}
              {isExpanded && (
                <div className="px-3.5 pb-3.5 pt-2 border-t border-border/20 space-y-3 animate-fadeIn text-xs">
                  {!isEditingType ? (
                    <>
                      {/* 顶部选项条 */}
                      <div className="flex items-center justify-between pb-2.5 border-b border-border/20">
                        <span className="text-[10.5px] text-muted-foreground font-light flex items-center gap-1.5">
                          {entry.addMemo ? "⭐ 带标题备忘" : ""}
                          {entry.useRegex ? "🌀 正则匹配" : ""}
                        </span>

                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => onStartInlineEdit(entry)}
                            className="text-[11px] bg-primary/10 hover:bg-primary hover:text-primary-foreground text-primary border border-primary/20 px-3 py-1.5 rounded-lg flex items-center gap-1 font-semibold transition select-none"
                          >
                            <Edit2 className="w-3.5 h-3.5" /> 编辑词条
                          </button>
                          <button
                            onClick={() => onDeleteEntry(entry)}
                            className="text-[11px] bg-rose-500/10 hover:bg-rose-600 hover:text-white text-rose-500 border border-rose-500/20 px-3 py-1.5 rounded-lg flex items-center gap-1 font-semibold transition select-none"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> 删除设定
                          </button>
                        </div>
                      </div>

                      {/* 元信息网格 */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-muted/20 p-2.5 rounded-lg text-[10.5px] text-muted-foreground font-mono">
                        <div>
                          <span className="text-muted-foreground/75">
                            触发关键词:{" "}
                          </span>
                          <span className="text-foreground font-medium">
                            {Array.isArray(entry.keys) && entry.keys.length > 0
                              ? entry.keys.join(", ")
                              : typeof entry.keys === "string" &&
                                  (entry.keys as string).trim()
                                ? entry.keys
                                : "(空)"}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground/75">
                            插入位置:{" "}
                          </span>
                          <span className="text-foreground font-medium">
                            {entry.position === "after_char_def"
                              ? "角色定义后"
                              : entry.position === "before_char_def"
                                ? "角色定义前"
                                : entry.position === "top"
                                  ? "对话最顶部"
                                  : entry.position === "in_chat"
                                    ? "历史对话中 (按深度)"
                                    : "最新发言上方"}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground/75">
                            优先级 / 深度:{" "}
                          </span>
                          <span className="text-foreground font-bold">
                            {entry.order !== undefined ? entry.order : 100} /{" "}
                            {entry.depth !== undefined ? entry.depth : 4}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground/75">
                            触发概率:{" "}
                          </span>
                          <span className="text-foreground font-bold">
                            {entry.probability !== undefined
                              ? entry.probability
                              : 100}
                            %
                          </span>
                        </div>
                      </div>

                      {/* 叙事内容块 */}
                      <div className="space-y-1">
                        <span className="block text-[10.2px] text-muted-foreground font-bold flex items-center gap-0.5">
                          <Sparkles className="w-3 h-3 text-amber-500 animate-pulse" />
                          设定叙述内容 (System Prompt 混编注入):
                        </span>
                        <p
                          className={`font-light leading-relaxed whitespace-pre-wrap rounded-lg bg-muted/40 p-2.5 border border-border/40 text-[11px] ${entry.disabled ? "line-through text-muted-foreground/50 bg-red-950/2" : "text-muted-foreground/90 font-medium"}`}
                        >
                          {entry.content}
                        </p>
                      </div>
                    </>
                  ) : (
                    /* 当前卡片内激活的内联编辑表单 */
                    <div className="space-y-3.5 pt-1.5 animate-fadeIn">
                      <InlineEntryForm
                        id={entry.id}
                        editForm={editForm}
                        setEditForm={setEditForm}
                        setEditingId={setEditingId}
                        onSave={onSaveInlineEntry}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
