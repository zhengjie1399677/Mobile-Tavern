import React, { useState } from "react";
import { ArrowLeft, Plus, Search, X } from "lucide-react";
import { useUnifiedApp } from "../../UnifiedAppContext";
import { LorebookEntry, CharacterCard } from "../../types";
import {
  useWorldbookActions,
  type EditFormState,
} from "./useWorldbookActions";
import WorldbookHeader from "./WorldbookHeader";
import CharacterWorldbookList from "./CharacterWorldbookList";
import CharacterWorldbookDetail from "./CharacterWorldbookDetail";
import EntriesGrid, { type EntriesGridProps } from "./EntriesGrid";
import InlineEntryForm, { type InlineEntryFormProps } from "./InlineEntryForm";

/**
 * 世界设定集 Tab 组合根。
 *
 * 负责：持有局部 state（搜索词 / 折叠态 / 内联编辑态）、计算派生数据
 * （当前宿主、原始条目、过滤后条目）、装配 useWorldbookActions Hook，
 * 并按 activeHostId 编排三种视图：全局 / 名录 / 角色详情。
 *
 * 原始实现位于 src/tabs/GlobalWorldbookTab.tsx，已按 AGENTS.md 单文件行数
 * 硬上限拆分至 src/tabs/worldbook/ 目录，外部消费者导入路径保持不变。
 */
export default function GlobalWorldbookTab() {
  const {
    characters = [],
    setCharacters,
    showCustomAlert,
    showCustomConfirm,
    showCustomPrompt,
    globalLorebook = [],
    setGlobalLorebook,
    activeWorldbookHostId,
    setActiveWorldbookHostId,
    customWorldbooks = {},
    updateCustomWorldbooks,
  } = useUnifiedApp();

  // 当前选中的宿主 ID： "list" / "global" / 具体角色卡 ID / 自定义设定集 ID
  const activeHostId = activeWorldbookHostId || "list";

  const isCustomWorldbook = !!(customWorldbooks && customWorldbooks[activeHostId]);

  // 当前目录下的本地搜索词
  const [searchQuery, setSearchQuery] = useState("");

  // 子条目折叠展开态
  const [expandedEntryIds, setExpandedEntryIds] = useState<
    Record<string, boolean>
  >({});

  // 内联编辑态
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditFormState>({});

  // 统计
  const globalCount = globalLorebook?.length || 0;

  // 当前激活的宿主对象
  const activeChar = characters.find((c) => c.id === activeHostId);
  const activeHostName =
    activeHostId === "global"
      ? "🌎 全局共用词库"
      : isCustomWorldbook
        ? `📖 【${customWorldbooks[activeHostId]?.name || "未命名设定集"}】独立设定集`
        : `👤 【${activeChar?.name || "未知宿体"}】专属回路`;

  // 当前宿主文件夹下的原始条目列表
  const activeHostRawEntries: LorebookEntry[] =
    activeHostId === "global"
      ? globalLorebook || []
      : isCustomWorldbook
        ? customWorldbooks[activeHostId]?.entries || []
        : activeChar?.lorebookEntries || [];

  // 按搜索词过滤当前宿主内的子条目
  const filteredChildEntries = activeHostRawEntries.filter((entry) => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return true;

    const matchComment = (entry.comment || "").toLowerCase().includes(query);
    const matchContent = (entry.content || "").toLowerCase().includes(query);
    const matchKeys = (entry.keys || []).some((k) =>
      k.toLowerCase().includes(query),
    );
    return matchComment || matchContent || matchKeys;
  });

  const actions = useWorldbookActions({
    characters,
    setCharacters,
    showCustomConfirm,
    showCustomAlert,
    showCustomPrompt,
    globalLorebook,
    setGlobalLorebook,
    customWorldbooks,
    updateCustomWorldbooks,
    activeHostId,
    isCustomWorldbook,
    editingId,
    setEditingId,
    editForm,
    setEditForm,
    setExpandedEntryIds,
  });
  const {
    toggleExpand,
    startInlineEdit,
    handleDeleteEntry,
    handleSaveInlineEntry,
    startNewInlineEntry,
    handleImportLorebookJSON,
    handleExportLorebookJSON,
    handleToggleCharacterWorldbookGlobal,
  } = actions;

  // 条目网格共享 props（全局与角色详情视图复用）
  const entriesGridProps: EntriesGridProps = {
    filteredChildEntries,
    expandedEntryIds,
    editingId,
    activeHostId,
    editForm,
    setEditForm,
    setEditingId,
    onToggleExpand: toggleExpand,
    onStartInlineEdit: startInlineEdit,
    onDeleteEntry: handleDeleteEntry,
    onSaveInlineEntry: handleSaveInlineEntry,
  };

  // 内联创建槽共享 props
  const inlineEntryFormProps: InlineEntryFormProps = {
    id: "new_inline_temp_creator",
    editForm,
    setEditForm,
    setEditingId,
    onSave: handleSaveInlineEntry,
  };

  const handleBackToList = () => {
    setActiveWorldbookHostId("list");
    setEditingId(null);
    setSearchQuery("");
  };

  const handleCancelCreator = () => {
    setEditingId(null);
    setEditForm({});
  };

  const handleSelectCharacter = (char: CharacterCard) => {
    setActiveWorldbookHostId(char.id);
    setSearchQuery("");
    setEditingId(null);
  };

  return (
    <div className="px-4 pb-4 pt-1.5 space-y-5 animate-fadeIn">
      <WorldbookHeader
        activeHostId={activeHostId}
        showCustomAlert={showCustomAlert}
        onImportLorebookJSON={handleImportLorebookJSON}
        onExportLorebookJSON={handleExportLorebookJSON}
      />

      {/* 动态工作区视图 */}
      {activeHostId === "global" ? (
        /* ==================== 全局条目工作区 ==================== */
        <div className="space-y-4 animate-fadeIn">
          {/* 全局头部行 + 返回按钮 */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-border/50 pb-3 gap-2 select-none">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleBackToList}
                className="flex items-center gap-1.5 h-7 px-2.5 bg-muted hover:bg-muted/80 text-foreground text-[11px] font-bold rounded-lg border border-border/50 transition active:scale-[0.96]"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>返回目录</span>
              </button>

              <div className="h-4 w-[1px] bg-border/60 hidden sm:block" />

              <div className="flex flex-col">
                <p className="text-xs font-extrabold text-primary flex items-center gap-1 leading-snug">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  <span>🌎 全局通用设定集</span>
                </p>
                <p className="text-[9px] text-muted-foreground font-light">
                  常驻装配所有 AI 角色
                </p>
              </div>
            </div>
          </div>

          {/* 搜索框 + 新建按钮 */}
          <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="在全局共享柜内检索触发词、描述、备注..."
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
                onClick={startNewInlineEntry}
                className="bg-primary hover:bg-primary/95 text-primary-foreground px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition active:scale-[0.98] shadow-sm select-none"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>添加通用记忆</span>
              </button>
            )}
          </div>

          {/* 工作区内联创建槽 */}
          {editingId === "new_inline_temp_creator" && (
            <div className="bg-card p-4 rounded-xl border border-primary/40 text-xs animate-fadeIn space-y-3 shadow-md">
              <div className="flex items-center justify-between border-b border-border/60 pb-1.5">
                <h3 className="font-bold text-primary flex items-center gap-1">
                  ✨ 新建世界设定 · 全局共享
                </h3>
                <button
                  onClick={handleCancelCreator}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <InlineEntryForm {...inlineEntryFormProps} />
            </div>
          )}

          {/* 条目列表卡片块 */}
          <EntriesGrid {...entriesGridProps} />
        </div>
      ) : activeHostId === "list" ? (
        /* ==================== 角色名录目录列表 ==================== */
        <CharacterWorldbookList
          characters={characters}
          onSelectCharacter={handleSelectCharacter}
          onToggleCharacterWorldbookGlobal={handleToggleCharacterWorldbookGlobal}
        />
      ) : (
        /* ==================== 单角色 / 自定义设定集详情视图 ==================== */
        <CharacterWorldbookDetail
          title={
            isCustomWorldbook
              ? `📖 【${customWorldbooks[activeHostId]?.name || "未命名设定集"}】独立设定集`
              : `👤 【${activeChar?.name || "未知宿体"}】专属回路`
          }
          subtitle={
            isCustomWorldbook
              ? "设定集内部词条已在全局共享中自动装配评估"
              : "正在为当前宿体定制特定的脑区记忆"
          }
          creatorTitle={
            <>
              ✨ 新建世界设定 ·{" "}
              {isCustomWorldbook
                ? customWorldbooks[activeHostId]?.name
                : activeChar?.name}{" "}
              {isCustomWorldbook ? "词条" : "专属"}
            </>
          }
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          editingId={editingId}
          onBack={handleBackToList}
          onStartNewInlineEntry={startNewInlineEntry}
          onCancelCreator={handleCancelCreator}
          entriesGridProps={entriesGridProps}
          inlineEntryFormProps={inlineEntryFormProps}
        />
      )}
    </div>
  );
}
