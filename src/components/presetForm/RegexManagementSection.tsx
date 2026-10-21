import React, { useState, useMemo } from "react";
import {
  Sparkles,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  Search,
  Maximize2,
  X,
  SlidersHorizontal,
} from "lucide-react";
import { Card, CardHeader, CardContent } from "@/src/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/src/components/ui/dialog";
import { useTranslation } from "../../contexts/LanguageContext";
import { useMobileBackHandler } from "../../hooks/useMobileBackHandler";
import { cn } from "@/src/lib/utils";
import type { Dispatch, SetStateAction } from "react";
import type { UserSettings, CharacterCard, RegexScript } from "../../types";
import type { EditableRegexScript } from "./usePresetFormState";
import RegexEditorDialog from "./RegexEditorDialog";
import { RegexCardItem } from "./RegexCardItem";
import { regexScriptKey, normalizeRegexScripts } from "../../domain/regex/regexScriptIdentity";

type RegexTab = "global" | "preset" | "character" | "all";

interface RegexManagementSectionProps {
  settings: UserSettings;
  activeCharacter: CharacterCard | null;
  isRegexFolded: boolean;
  handleToggleRegexFold: () => void;
  activeGlobalRegex: number;
  activePresetRegex: number;
  activeCharRegex: number;
  selectedGlobalRegexIds: string[];
  setSelectedGlobalRegexIds: (value: string[] | ((prev: string[]) => string[])) => void;
  selectedPresetRegexIds: string[];
  setSelectedPresetRegexIds: (value: string[] | ((prev: string[]) => string[])) => void;
  isBatchDeletingGlobalRegex: boolean;
  setIsBatchDeletingGlobalRegex: (value: boolean | ((prev: boolean) => boolean)) => void;
  isBatchDeletingPresetRegex: boolean;
  setIsBatchDeletingPresetRegex: (value: boolean | ((prev: boolean) => boolean)) => void;
  handleBatchDeleteGlobalRegex: () => Promise<void>;
  handleBatchDeletePresetRegex: () => Promise<void>;
  editingRegex: EditableRegexScript | null;
  setEditingRegex: Dispatch<SetStateAction<EditableRegexScript | null>>;
  isRegexModalOpen: boolean;
  setIsRegexModalOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  toggleRegexDisabled: (id: string, disabled: boolean, scope: "global" | "preset" | "character") => void;
  deleteRegex: (id: string, name: string, scope: "global" | "preset" | "character") => Promise<void>;
  saveRegex: (reg: EditableRegexScript) => Promise<void>;
}

export default function RegexManagementSection({
  settings,
  activeCharacter,
  isRegexFolded,
  handleToggleRegexFold,
  activeGlobalRegex,
  activePresetRegex,
  activeCharRegex,
  selectedGlobalRegexIds,
  setSelectedGlobalRegexIds,
  selectedPresetRegexIds,
  setSelectedPresetRegexIds,
  isBatchDeletingGlobalRegex,
  setIsBatchDeletingGlobalRegex,
  isBatchDeletingPresetRegex,
  setIsBatchDeletingPresetRegex,
  handleBatchDeleteGlobalRegex,
  handleBatchDeletePresetRegex,
  editingRegex,
  setEditingRegex,
  isRegexModalOpen,
  setIsRegexModalOpen,
  toggleRegexDisabled,
  deleteRegex,
  saveRegex,
}: RegexManagementSectionProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<RegexTab>("global");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [isStudioOpen, setIsStudioOpen] = useState(false);

  useMobileBackHandler(isStudioOpen, () => {
    setIsStudioOpen(false);
    return true;
  }, 840);

  const charRegexScripts = useMemo(() => {
    return normalizeRegexScripts(activeCharacter?.extensions?.regex_scripts);
  }, [activeCharacter?.extensions?.regex_scripts]);

  const globalList = settings.globalRegexScripts || [];
  const presetList = settings.presetRegexScripts || [];
  const charList = charRegexScripts;

  // 搜索关键字过滤助手
  const filterList = (list: readonly RegexScript[]) => {
    if (!searchKeyword.trim()) return list;
    const kw = searchKeyword.trim().toLowerCase();
    return list.filter((r) => {
      const name = (r.scriptName || "").toLowerCase();
      const find = (r.findRegex || "").toLowerCase();
      const repl = (r.replaceString || "").toLowerCase();
      return name.includes(kw) || find.includes(kw) || repl.includes(kw);
    });
  };

  const filteredGlobal = useMemo(() => filterList(globalList), [globalList, searchKeyword]);
  const filteredPreset = useMemo(() => filterList(presetList), [presetList, searchKeyword]);
  const filteredChar = useMemo(() => filterList(charList), [charList, searchKeyword]);

  // 新建规则快捷动作
  const handleOpenCreate = (scope: "global" | "preset" | "character") => {
    setEditingRegex({
      id: "reg_" + Math.random().toString(36).substring(2, 9) + Date.now().toString(36),
      scriptName: "",
      findRegex: "",
      replaceString: "",
      disabled: false,
      placement: [2],
      runOnEdit: true,
      markdownOnly: false,
      promptOnly: false,
      scope,
    });
    setIsRegexModalOpen(true);
  };

  // 渲染单轨或全部列表内容
  const renderTabContent = (isModalView = false) => {
    const showGlobal = activeTab === "global" || activeTab === "all";
    const showPreset = activeTab === "preset" || activeTab === "all";
    const showChar = activeTab === "character" || activeTab === "all";

    return (
      <div className="space-y-6">
        {/* 全局正则模块 */}
        {showGlobal && (
          <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="space-y-0.5">
                <span className="block text-xs sm:text-sm font-bold text-sky-500">
                  {t("regex.global")}
                </span>
                <span className="text-[11px] text-muted-foreground block">
                  {t("regex.global_tip")}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {isBatchDeletingGlobalRegex ? (
                  <>
                    <button
                      type="button"
                      onClick={handleBatchDeleteGlobalRegex}
                      disabled={selectedGlobalRegexIds.length === 0}
                      className="text-xs font-bold text-rose-500 bg-rose-500/10 hover:bg-rose-500/20 px-2.5 py-1.5 rounded-lg border border-rose-500/30 flex items-center gap-1.5 transition disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
                    >
                      <Trash2 className="size-3.5" /> {t("prompts.confirm_delete")} ({selectedGlobalRegexIds.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsBatchDeletingGlobalRegex(false);
                        setSelectedGlobalRegexIds([]);
                      }}
                      className="text-xs font-medium text-muted-foreground bg-muted hover:bg-muted/80 px-2.5 py-1.5 rounded-lg border border-border flex items-center gap-1 transition active:scale-95"
                    >
                      {t("prompts.cancel")}
                    </button>
                  </>
                ) : (
                  <>
                    {globalList.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setIsBatchDeletingGlobalRegex(true)}
                        className="text-xs font-medium text-muted-foreground hover:text-destructive bg-muted/40 hover:bg-destructive/10 px-2.5 py-1.5 rounded-lg border border-border hover:border-destructive/30 flex items-center gap-1 transition active:scale-95"
                      >
                        {t("prompts.batch_delete")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleOpenCreate("global")}
                      className="text-xs font-bold text-primary bg-primary/10 hover:bg-primary/20 px-3 py-1.5 border border-primary/30 rounded-lg flex items-center gap-1.5 transition active:scale-95"
                    >
                      <Plus className="size-3.5" /> {t("regex.create_global")}
                    </button>
                  </>
                )}
              </div>
            </div>

            {filteredGlobal.length === 0 ? (
              <div className="border border-dashed border-border/60 rounded-xl p-5 text-center text-muted-foreground flex flex-col items-center justify-center gap-2 bg-muted/5">
                <span className="text-xs text-muted-foreground/75 leading-relaxed max-w-md">
                  {searchKeyword ? "未搜索到匹配的全局正则规则" : t("regex.no_global")}
                </span>
                {!searchKeyword && (
                  <button
                    type="button"
                    onClick={() => handleOpenCreate("global")}
                    className="text-xs font-medium text-primary hover:underline flex items-center gap-1 pt-1"
                  >
                    <Plus className="size-3" /> 立即新建全局规则
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2.5">
                {filteredGlobal.map((r) => {
                  const targetId = regexScriptKey(r);
                  return (
                    <RegexCardItem
                      key={targetId}
                      script={r}
                      scope="global"
                      scopeLabel={activeTab === "all" ? "全局" : undefined}
                      isBatchDeleting={isBatchDeletingGlobalRegex}
                      isSelected={selectedGlobalRegexIds.includes(targetId)}
                      onToggleSelect={(checked) => {
                        if (checked) {
                          setSelectedGlobalRegexIds((prev) => [...prev, targetId]);
                        } else {
                          setSelectedGlobalRegexIds((prev) => prev.filter((id) => id !== targetId));
                        }
                      }}
                      onToggleDisabled={(disabled) => toggleRegexDisabled(targetId, disabled, "global")}
                      onEdit={() => {
                        setEditingRegex({ ...r, scope: "global", id: targetId });
                        setIsRegexModalOpen(true);
                      }}
                      onDelete={() => deleteRegex(targetId, r.scriptName, "global")}
                      t={t}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 预设专属正则模块 */}
        {showPreset && (
          <div className={cn("space-y-3", activeTab === "all" && "pt-4 border-t border-border/40")}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="space-y-0.5">
                <span className="block text-xs sm:text-sm font-bold text-violet-500">
                  {t("regex.preset")}
                </span>
                <span className="text-[11px] text-muted-foreground block">
                  {t("regex.preset_tip", { name: settings.preset.name })}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {isBatchDeletingPresetRegex ? (
                  <>
                    <button
                      type="button"
                      onClick={handleBatchDeletePresetRegex}
                      disabled={selectedPresetRegexIds.length === 0}
                      className="text-xs font-bold text-rose-500 bg-rose-500/10 hover:bg-rose-500/20 px-2.5 py-1.5 rounded-lg border border-rose-500/30 flex items-center gap-1.5 transition disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
                    >
                      <Trash2 className="size-3.5" /> {t("prompts.confirm_delete")} ({selectedPresetRegexIds.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsBatchDeletingPresetRegex(false);
                        setSelectedPresetRegexIds([]);
                      }}
                      className="text-xs font-medium text-muted-foreground bg-muted hover:bg-muted/80 px-2.5 py-1.5 rounded-lg border border-border flex items-center gap-1 transition active:scale-95"
                    >
                      {t("prompts.cancel")}
                    </button>
                  </>
                ) : (
                  <>
                    {presetList.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setIsBatchDeletingPresetRegex(true)}
                        className="text-xs font-medium text-muted-foreground hover:text-destructive bg-muted/40 hover:bg-destructive/10 px-2.5 py-1.5 rounded-lg border border-border hover:border-destructive/30 flex items-center gap-1 transition active:scale-95"
                      >
                        {t("prompts.batch_delete")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleOpenCreate("preset")}
                      className="text-xs font-bold text-primary bg-primary/10 hover:bg-primary/20 px-3 py-1.5 border border-primary/30 rounded-lg flex items-center gap-1.5 transition active:scale-95"
                    >
                      <Plus className="size-3.5" /> {t("regex.create_preset")}
                    </button>
                  </>
                )}
              </div>
            </div>

            {filteredPreset.length === 0 ? (
              <div className="border border-dashed border-border/60 rounded-xl p-5 text-center text-muted-foreground flex flex-col items-center justify-center gap-2 bg-muted/5">
                <span className="text-xs text-muted-foreground/75 leading-relaxed max-w-md">
                  {searchKeyword ? "未搜索到匹配的预设专属正则" : t("regex.no_preset")}
                </span>
                {!searchKeyword && (
                  <button
                    type="button"
                    onClick={() => handleOpenCreate("preset")}
                    className="text-xs font-medium text-primary hover:underline flex items-center gap-1 pt-1"
                  >
                    <Plus className="size-3" /> 立即新建预设专属规则
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2.5">
                {filteredPreset.map((r) => {
                  const targetId = regexScriptKey(r);
                  return (
                    <RegexCardItem
                      key={targetId}
                      script={r}
                      scope="preset"
                      scopeLabel={activeTab === "all" ? "预设" : undefined}
                      isBatchDeleting={isBatchDeletingPresetRegex}
                      isSelected={selectedPresetRegexIds.includes(targetId)}
                      onToggleSelect={(checked) => {
                        if (checked) {
                          setSelectedPresetRegexIds((prev) => [...prev, targetId]);
                        } else {
                          setSelectedPresetRegexIds((prev) => prev.filter((id) => id !== targetId));
                        }
                      }}
                      onToggleDisabled={(disabled) => toggleRegexDisabled(targetId, disabled, "preset")}
                      onEdit={() => {
                        setEditingRegex({ ...r, scope: "preset", id: targetId });
                        setIsRegexModalOpen(true);
                      }}
                      onDelete={() => deleteRegex(targetId, r.scriptName, "preset")}
                      t={t}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 活跃角色专属局部正则模块 */}
        {showChar && (
          <div className={cn("space-y-3", activeTab === "all" && "pt-4 border-t border-border/40")}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="space-y-0.5">
                <span className="block text-xs sm:text-sm font-bold text-amber-500">
                  {t("regex.char")}
                </span>
                <span className="text-[11px] text-muted-foreground block">
                  {t("regex.char_tip", { name: activeCharacter?.name || t("regex.char_no_active") })}
                </span>
              </div>

              {activeCharacter && (
                <button
                  type="button"
                  onClick={() => handleOpenCreate("character")}
                  className="text-xs font-bold text-primary bg-primary/10 hover:bg-primary/20 px-3 py-1.5 border border-primary/30 rounded-lg flex items-center gap-1.5 transition active:scale-95"
                >
                  <Plus className="size-3.5" /> {t("regex.create_char")}
                </button>
              )}
            </div>

            {filteredChar.length === 0 ? (
              <div className="border border-dashed border-border/60 rounded-xl p-5 text-center text-muted-foreground flex flex-col items-center justify-center gap-2 bg-muted/5">
                <span className="text-xs text-muted-foreground/75 leading-relaxed max-w-md">
                  {searchKeyword ? "未搜索到匹配的角色专属局部正则" : t("regex.no_char")}
                </span>
                {!searchKeyword && activeCharacter && (
                  <button
                    type="button"
                    onClick={() => handleOpenCreate("character")}
                    className="text-xs font-medium text-primary hover:underline flex items-center gap-1 pt-1"
                  >
                    <Plus className="size-3" /> 立即为【{activeCharacter.name}】新建局部规则
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2.5">
                {filteredChar.map((r: RegexScript) => {
                  const targetId = regexScriptKey(r);
                  return (
                    <RegexCardItem
                      key={targetId}
                      script={r}
                      scope="character"
                      scopeLabel={activeTab === "all" ? "角色" : undefined}
                      onToggleDisabled={(disabled) => toggleRegexDisabled(targetId, disabled, "character")}
                      onEdit={() => {
                        setEditingRegex({ ...r, scope: "character", id: targetId });
                        setIsRegexModalOpen(true);
                      }}
                      onDelete={() => deleteRegex(targetId, r.scriptName, "character")}
                      t={t}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // 渲染顶部工具条与 Tab 选择器
  const renderNavAndSearch = () => {
    return (
      <div className="space-y-3">
        {/* Tab 切换栏 */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-muted/40 border border-border/50 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setActiveTab("global")}
            className={cn(
              "flex-1 min-w-[76px] py-1.5 px-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1 shrink-0",
              activeTab === "global"
                ? "bg-background text-primary shadow-xs border border-border/60"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            <span>🌌 全局</span>
            <span className="text-[10px] font-mono px-1 rounded-full bg-muted/80 text-muted-foreground">
              {globalList.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("preset")}
            className={cn(
              "flex-1 min-w-[76px] py-1.5 px-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1 shrink-0",
              activeTab === "preset"
                ? "bg-background text-primary shadow-xs border border-border/60"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            <span>📋 预设</span>
            <span className="text-[10px] font-mono px-1 rounded-full bg-muted/80 text-muted-foreground">
              {presetList.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("character")}
            className={cn(
              "flex-1 min-w-[76px] py-1.5 px-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1 shrink-0",
              activeTab === "character"
                ? "bg-background text-primary shadow-xs border border-border/60"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            <span>🎭 角色</span>
            <span className="text-[10px] font-mono px-1 rounded-full bg-muted/80 text-muted-foreground">
              {charList.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("all")}
            className={cn(
              "flex-1 min-w-[76px] py-1.5 px-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1 shrink-0",
              activeTab === "all"
                ? "bg-background text-primary shadow-xs border border-border/60"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            <span>📑 全部</span>
            <span className="text-[10px] font-mono px-1 rounded-full bg-muted/80 text-muted-foreground">
              {globalList.length + presetList.length + charList.length}
            </span>
          </button>
        </div>

        {/* 搜索栏 */}
        <div className="relative">
          <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            placeholder="搜索正则名称、匹配模式或替换内容..."
            className="w-full h-9 pl-8 pr-8 rounded-lg bg-background/80 border border-border/60 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/60 transition-all"
          />
          {searchKeyword && (
            <button
              type="button"
              onClick={() => setSearchKeyword("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <Card
        className={cn(
          "glass-panel shadow-sm transition-all duration-300 rounded-2xl border border-border/60 bg-card/60 backdrop-blur-xs overflow-hidden",
          isRegexFolded ? "gap-0" : "",
        )}
      >
        <CardHeader
          className={cn(
            "cursor-pointer hover:bg-muted/20 transition select-none py-3 px-3.5 sm:px-4",
            isRegexFolded ? "border-b-0" : "border-b border-border/30",
          )}
          onClick={handleToggleRegexFold}
        >
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shrink-0">
                <Sparkles className="w-4 h-4" />
              </span>
              <div className="flex flex-col items-start min-w-0">
                <span className="text-xs sm:text-sm font-semibold text-foreground shrink-0">
                  {t("regex.title")}
                </span>
                {!isRegexFolded && (
                  <span className="text-[11px] text-muted-foreground/75 font-normal truncate max-w-[170px] sm:max-w-none">
                    {t("regex.subtitle")}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {!isRegexFolded && (
                <button
                  type="button"
                  title="在独立大窗口中打开正则管理工作台"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsStudioOpen(true);
                  }}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 border border-border/50 hover:border-primary/30 transition-colors active:scale-95"
                >
                  <Maximize2 className="size-3.5" />
                  <span className="hidden sm:inline">独立工作台</span>
                </button>
              )}

              {isRegexFolded && (
                <span className="text-[10px] text-cyan-400 font-mono bg-cyan-500/10 px-2 py-0.5 rounded-full border border-cyan-500/20 truncate max-w-[170px] sm:max-w-none">
                  {t("regex.folded_summary", {
                    global: activeGlobalRegex,
                    preset: activePresetRegex,
                    character: activeCharRegex,
                  })}
                </span>
              )}

              {isRegexFolded ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
            </div>
          </div>
        </CardHeader>

        {/* 展开后的主卡片内容：彻底移除 max-h-[160px]，自然流动，无嵌套滚动条折磨 */}
        {!isRegexFolded && (
          <CardContent className="pt-4 pb-5 px-3.5 sm:px-4 space-y-4">
            {renderNavAndSearch()}
            {renderTabContent(false)}
          </CardContent>
        )}
      </Card>

      {/* 独立大窗口工作台 Dialog（提供开阔视界与舒适编辑空间） */}
      <Dialog
        open={isStudioOpen}
        onOpenChange={(open) => {
          if (!open) setIsStudioOpen(false);
        }}
      >
        <DialogContent
          showCloseButton={false}
          overlayClassName="bg-black/65 backdrop-blur-md"
          className="flex flex-col w-[94vw] max-w-4xl h-[86vh] max-h-[86vh] p-0 overflow-hidden rounded-2xl border border-border/80 bg-background shadow-2xl"
        >
          {/* 工作台顶部 */}
          <div className="px-4 sm:px-6 py-3.5 border-b border-border/60 bg-muted/30 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
                <SlidersHorizontal className="size-4" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="text-sm sm:text-base font-bold text-foreground">
                  正则脚本管理工作台
                </DialogTitle>
                <p className="text-[11px] text-muted-foreground truncate">
                  全局、预设与角色卡正则规则的开阔编辑环境
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsStudioOpen(false)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* 工作台主体（开阔滚动视图） */}
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 sm:p-6 space-y-4">
            {renderNavAndSearch()}
            {renderTabContent(true)}
          </div>
        </DialogContent>
      </Dialog>

      {/* 新建/编辑正则 Modal 浮窗 */}
      <RegexEditorDialog
        editingRegex={editingRegex}
        setEditingRegex={setEditingRegex}
        isRegexModalOpen={isRegexModalOpen}
        setIsRegexModalOpen={setIsRegexModalOpen}
        saveRegex={saveRegex}
      />
    </>
  );
}
