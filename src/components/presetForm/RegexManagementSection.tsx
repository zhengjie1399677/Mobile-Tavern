import { Sparkles, ChevronDown, ChevronUp, Plus, Trash2, SlidersHorizontal } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../../components/ui/card";
import { useTranslation } from "../../contexts/LanguageContext";
import { Switch } from "../../../components/ui/switch";
import { Checkbox } from "../../../components/ui/checkbox";
import { Input } from "../../../components/ui/input";
import { cn } from "../../../lib/utils";
import { useState, type Dispatch, type SetStateAction } from "react";
import type { UserSettings, CharacterCard, RegexScript } from "../../types";
import type { EditableRegexScript } from "./usePresetFormState";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "../../../components/ui/dialog";
import { useMobileBackHandler } from "../../hooks/useMobileBackHandler";

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

function renderRuleBadges(r: RegexScript, t: (k: string) => string) {
  const placement = r.placement;
  let placementText = t("regex.placement_output");
  if (placement && placement.length > 0) {
    const tags: string[] = [];
    if (placement.includes(1)) tags.push("输入");
    if (placement.includes(2)) tags.push("输出");
    if (placement.includes(6)) tags.push("思维链");
    if (placement.includes(5)) tags.push("世界书");
    if (placement.includes(3)) tags.push("命令");
    placementText = tags.join("·") || t("regex.placement_output");
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[8px] font-semibold px-1 py-0.2 border border-border/80 rounded bg-background text-muted-foreground">
        {placementText}
      </span>
      {r.markdownOnly && (
        <span className="text-[8px] font-semibold px-1 py-0.2 border border-primary/30 rounded bg-primary/10 text-primary">
          仅渲染
        </span>
      )}
      {r.promptOnly && (
        <span className="text-[8px] font-semibold px-1 py-0.2 border border-amber-500/30 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
          仅Prompt
        </span>
      )}
      {r.substituteRegex === 2 && (
        <span className="text-[8px] font-semibold px-1 py-0.2 border border-emerald-500/30 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          安全转义
        </span>
      )}
      {((r.minDepth !== undefined && r.minDepth !== null) || (r.maxDepth !== undefined && r.maxDepth !== null)) && (
        <span className="text-[8px] font-semibold px-1 py-0.2 border border-border rounded bg-muted/60 text-muted-foreground font-mono">
          深度 {r.minDepth ?? 0}~{r.maxDepth ?? "∞"}
        </span>
      )}
      {r.trimStrings && r.trimStrings.length > 0 && (
        <span className="text-[8px] font-semibold px-1 py-0.2 border border-border rounded bg-muted/60 text-muted-foreground font-mono">
          裁剪{r.trimStrings.length}项
        </span>
      )}
    </div>
  );
}

/** 4. 正则过滤脚本管理（全局 / 预设 / 角色只读 + 编辑 Modal） */
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const closeRegexModal = () => {
    setIsRegexModalOpen(false);
    setEditingRegex(null);
    setShowAdvanced(false);
  };

  useMobileBackHandler(isRegexModalOpen, () => {
    closeRegexModal();
    return true;
  }, 850);

  return (
    <>
      <Card className={cn("glass-panel shadow-sm transition-all duration-300", isRegexFolded ? "py-2 gap-0" : "")}>
        <CardHeader
          className={cn("cursor-pointer hover:bg-muted/20 transition select-none", isRegexFolded ? "pb-0 border-b-0" : "pb-3 border-b border-border/50")}
          onClick={handleToggleRegexFold}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 shrink-0 text-foreground">
              <Sparkles className="w-4 h-4 text-primary" /> {t("regex.title")}
            </CardTitle>
            <div className="flex items-center gap-2 overflow-hidden">
              {isRegexFolded && (
                <span className="text-[10px] text-muted-foreground/80 font-mono bg-muted/40 px-1.5 py-0.5 rounded border border-border/30 truncate max-w-[150px] sm:max-w-none">
                  全局: {activeGlobalRegex} | 预设: {activePresetRegex} | 角色: {activeCharRegex}
                </span>
              )}
              {isRegexFolded ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
            </div>
          </div>
          {!isRegexFolded && (
            <CardDescription className="text-[10px] text-muted-foreground font-normal mt-0.5">
              {t("regex.subtitle")}
            </CardDescription>
          )}
        </CardHeader>
        {!isRegexFolded && (
          <CardContent className="pt-4 space-y-5">
          {/* 轨1. 全局正则 */}
          <div className="space-y-3">
            <div className="flex justify-between items-center flex-wrap gap-2">
              <div className="space-y-0.5">
                <span className="block text-[11px] font-bold text-primary">
                  {t("regex.global")}
                </span>
                <span className="text-[9.5px] text-muted-foreground block">
                  {t("regex.global_tip")}
                </span>
              </div>
              <div className="flex gap-2">
                {isBatchDeletingGlobalRegex ? (
                   <>
                    <button
                      type="button"
                      onClick={handleBatchDeleteGlobalRegex}
                      disabled={selectedGlobalRegexIds.length === 0}
                      className="text-[10px] font-bold text-rose-500 bg-rose-500/10 hover:bg-rose-500/20 px-2 py-1 border border-rose-500/20 flex items-center gap-1 transition disabled:opacity-50 disabled:cursor-not-allowed tap-scale"
                    >
                      <Trash2 className="w-3 h-3" /> {t("prompts.confirm_delete")} ({selectedGlobalRegexIds.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsBatchDeletingGlobalRegex(false);
                        setSelectedGlobalRegexIds([]);
                      }}
                      className="text-[10px] font-bold text-muted-foreground bg-muted hover:bg-muted/80 px-2 py-1 border border-border flex items-center gap-1 transition tap-scale"
                    >
                      {t("prompts.cancel")}
                    </button>
                  </>
                ) : (
                  <>
                    {settings.globalRegexScripts && settings.globalRegexScripts.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setIsBatchDeletingGlobalRegex(true)}
                        className="text-[10px] font-bold text-muted-foreground hover:text-destructive bg-muted/40 hover:bg-destructive/10 px-2 py-1 border border-border hover:border-destructive/20 flex items-center gap-1 transition tap-scale"
                      >
                        {t("prompts.batch_delete")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
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
                          scope: "global",
                        });
                        setIsRegexModalOpen(true);
                      }}
                      className="text-[10px] font-bold text-primary bg-primary/10 hover:bg-primary/20 px-2 py-1 border border-primary/25 rounded-md flex items-center gap-1 transition tap-scale"
                    >
                      <Plus className="w-2.5 h-2.5" /> {t("regex.create_global")}
                    </button>
                  </>
                )}
              </div>
            </div>

            {(!settings.globalRegexScripts || settings.globalRegexScripts.length === 0) ? (
              <div className="border border-dashed border-border/50 rounded-xl p-4 text-center text-muted-foreground flex flex-col items-center justify-center gap-1.5">
                <span className="text-[10px] font-light text-muted-foreground/60 leading-relaxed">
                  {t("regex.no_global")}
                </span>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[160px] overflow-y-auto custom-scrollbar pr-1">
                {settings.globalRegexScripts.map((r) => (
                  <div
                    key={r.id}
                    className={`border border-border/40 rounded-lg p-2 bg-muted/10 flex items-center justify-between gap-3 transition ${
                      r.disabled ? "opacity-60" : ""
                    }`}
                  >
                    {isBatchDeletingGlobalRegex && (
                      <Checkbox
                        checked={selectedGlobalRegexIds.includes(r.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedGlobalRegexIds((prev) => [...prev, r.id]);
                          } else {
                            setSelectedGlobalRegexIds((prev) => prev.filter((id) => id !== r.id));
                          }
                        }}
                        className="shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold truncate ${r.disabled ? "text-muted-foreground line-through" : "text-foreground"}`}>
                          {r.scriptName}
                        </span>
                        {renderRuleBadges(r, t)}
                      </div>
                      <div className="text-[9px] text-muted-foreground font-mono truncate mt-0.5">
                        {r.findRegex} ➔ {r.replaceString === "" ? "(删除)" : r.replaceString}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 scale-90">
                      <Switch
                        aria-label={`启用全局正则规则 ${r.scriptName}`}
                        checked={!r.disabled}
                        onCheckedChange={(checked) => toggleRegexDisabled(r.id, !checked, "global")}
                        className="data-[state=checked]:bg-primary h-3 w-6 [&_span]:h-2 [&_span]:w-2"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setEditingRegex({ ...r, scope: "global" });
                          setIsRegexModalOpen(true);
                        }}
                        className="text-[9px] text-muted-foreground hover:text-primary transition font-semibold px-1.5 py-0.5 rounded hover:bg-muted"
                      >
                        {t("regex.edit")}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteRegex(r.id, r.scriptName, "global")}
                        className="text-[9px] text-rose-500 hover:text-rose-700 transition font-semibold px-1.5 py-0.5 rounded hover:bg-rose-950/20"
                      >
                        {t("regex.delete")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 轨2. 预设正则 */}
          <div className="space-y-3 pt-3 border-t border-border/40">
            <div className="flex justify-between items-center flex-wrap gap-2">
              <div className="space-y-0.5">
                <span className="block text-[11px] font-bold text-primary">
                  {t("regex.preset")}
                </span>
                <span className="text-[9.5px] text-muted-foreground block">
                  {t("regex.preset_tip", { name: settings.preset.name })}
                </span>
              </div>
              <div className="flex gap-2">
                {isBatchDeletingPresetRegex ? (
                  <>
                    <button
                      type="button"
                      onClick={handleBatchDeletePresetRegex}
                      disabled={selectedPresetRegexIds.length === 0}
                      className="text-[10px] font-bold text-rose-500 bg-rose-500/10 hover:bg-rose-500/20 px-2 py-1 border border-rose-500/20 flex items-center gap-1 transition disabled:opacity-50 disabled:cursor-not-allowed tap-scale"
                    >
                      <Trash2 className="w-3 h-3" /> {t("prompts.confirm_delete")} ({selectedPresetRegexIds.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsBatchDeletingPresetRegex(false);
                        setSelectedPresetRegexIds([]);
                      }}
                      className="text-[10px] font-bold text-muted-foreground bg-muted hover:bg-muted/80 px-2 py-1 border border-border flex items-center gap-1 transition tap-scale"
                    >
                      {t("prompts.cancel")}
                    </button>
                  </>
                ) : (
                  <>
                    {settings.presetRegexScripts && settings.presetRegexScripts.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setIsBatchDeletingPresetRegex(true)}
                        className="text-[10px] font-bold text-muted-foreground hover:text-destructive bg-muted/40 hover:bg-destructive/10 px-2 py-1 border border-border hover:border-destructive/20 flex items-center gap-1 transition tap-scale"
                      >
                        {t("prompts.batch_delete")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
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
                          scope: "preset",
                        });
                        setIsRegexModalOpen(true);
                      }}
                      className="text-[10px] font-bold text-primary bg-primary/10 hover:bg-primary/20 px-2 py-1 border border-primary/25 rounded-md flex items-center gap-1 transition tap-scale"
                    >
                      <Plus className="w-2.5 h-2.5" /> {t("regex.create_preset")}
                    </button>
                  </>
                )}
              </div>
            </div>

            {(!settings.presetRegexScripts || settings.presetRegexScripts.length === 0) ? (
              <div className="border border-dashed border-border/50 rounded-xl p-4 text-center text-muted-foreground flex flex-col items-center justify-center gap-1.5">
                <span className="text-[10px] font-light text-muted-foreground/60 leading-relaxed">
                  {t("regex.no_preset")}
                </span>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[160px] overflow-y-auto custom-scrollbar pr-1">
                {settings.presetRegexScripts.map((r) => (
                  <div
                    key={r.id}
                    className={`border border-border/40 rounded-lg p-2 bg-muted/10 flex items-center justify-between gap-3 transition ${
                      r.disabled ? "opacity-60" : ""
                    }`}
                  >
                    {isBatchDeletingPresetRegex && (
                      <Checkbox
                        checked={selectedPresetRegexIds.includes(r.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedPresetRegexIds((prev) => [...prev, r.id]);
                          } else {
                            setSelectedPresetRegexIds((prev) => prev.filter((id) => id !== r.id));
                          }
                        }}
                        className="shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold truncate ${r.disabled ? "text-muted-foreground line-through" : "text-foreground"}`}>
                          {r.scriptName}
                        </span>
                        {renderRuleBadges(r, t)}
                      </div>
                      <div className="text-[9px] text-muted-foreground font-mono truncate mt-0.5">
                        {r.findRegex} ➔ {r.replaceString === "" ? "(删除)" : r.replaceString}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 scale-90">
                      <Switch
                        aria-label={`启用预设正则规则 ${r.scriptName}`}
                        checked={!r.disabled}
                        onCheckedChange={(checked) => toggleRegexDisabled(r.id, !checked, "preset")}
                        className="data-[state=checked]:bg-primary h-3 w-6 [&_span]:h-2 [&_span]:w-2"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setEditingRegex({ ...r, scope: "preset" });
                          setIsRegexModalOpen(true);
                        }}
                        className="text-[9px] text-muted-foreground hover:text-primary transition font-semibold px-1.5 py-0.5 rounded hover:bg-muted"
                      >
                        {t("regex.edit")}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteRegex(r.id, r.scriptName, "preset")}
                        className="text-[9px] text-rose-500 hover:text-rose-700 transition font-semibold px-1.5 py-0.5 rounded hover:bg-rose-950/20"
                      >
                        {t("regex.delete")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 轨3. 角色局部正则（可编辑展示） */}
          <div className="space-y-3 pt-3 border-t border-border/40">
            <div className="flex justify-between items-center flex-wrap gap-2">
              <div className="space-y-0.5">
                <span className="block text-[11px] font-bold text-primary">
                  {t("regex.char")}
                </span>
                <span className="text-[9.5px] text-muted-foreground block">
                  {t("regex.char_tip", { name: activeCharacter?.name || t("regex.char_no_active") })}
                </span>
              </div>
              {activeCharacter && (
                <button
                  type="button"
                  onClick={() => {
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
                      scope: "character",
                    });
                    setIsRegexModalOpen(true);
                  }}
                  className="text-[10px] font-bold text-primary bg-primary/10 hover:bg-primary/20 px-2 py-1 border border-primary/25 rounded-md flex items-center gap-1 transition tap-scale"
                >
                  <Plus className="w-2.5 h-2.5" /> {t("regex.create_char")}
                </button>
              )}
            </div>

            {(!activeCharacter || !activeCharacter.extensions?.regex_scripts || activeCharacter.extensions.regex_scripts.length === 0) ? (
              <div className="border border-dashed border-border/50 rounded-xl p-4 text-center text-muted-foreground flex flex-col items-center justify-center gap-1.5">
                <span className="text-[10px] font-light text-muted-foreground/60 leading-relaxed">
                  {t("regex.no_char")}
                </span>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[160px] overflow-y-auto custom-scrollbar pr-1">
                {activeCharacter.extensions.regex_scripts.map((r: RegexScript) => {
                  const targetId = r.id || r.scriptName;
                  return (
                    <div
                      key={targetId}
                      className={`border border-border/30 rounded-lg p-2 bg-muted/5 flex items-center justify-between gap-3 transition ${
                        r.disabled ? "opacity-60" : ""
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-semibold truncate ${r.disabled ? "text-muted-foreground line-through" : "text-foreground"}`}>
                            {r.scriptName}
                          </span>
                          {renderRuleBadges(r, t)}
                        </div>
                        <div className="text-[9px] text-muted-foreground font-mono truncate mt-0.5">
                          {r.findRegex} ➔ {r.replaceString === "" ? "(删除)" : r.replaceString}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 scale-90">
                        <Switch
                          aria-label={`启用角色正则规则 ${r.scriptName}`}
                          checked={!r.disabled}
                          onCheckedChange={(checked) => toggleRegexDisabled(targetId, !checked, "character")}
                          className="data-[state=checked]:bg-primary h-3 w-6 [&_span]:h-2 [&_span]:w-2"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setEditingRegex({ ...r, scope: "character", id: targetId });
                            setIsRegexModalOpen(true);
                          }}
                          className="text-[9px] text-muted-foreground hover:text-primary transition font-semibold px-1.5 py-0.5 rounded hover:bg-muted"
                        >
                          {t("regex.edit")}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteRegex(targetId, r.scriptName, "character")}
                          className="text-[9px] text-rose-500 hover:text-rose-700 transition font-semibold px-1.5 py-0.5 rounded hover:bg-rose-950/20"
                        >
                          {t("regex.delete")}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
        )}
      </Card>

      {/* 新建/编辑正则 Modal 浮窗 */}
      <Dialog open={isRegexModalOpen} onOpenChange={(open) => { if (!open) closeRegexModal(); }}>
        <DialogContent
          showCloseButton={false}
          overlayClassName="bg-black/60 backdrop-blur-sm"
          className="flex w-full max-w-md flex-col gap-0 overflow-hidden rounded-xl border border-border bg-background p-0 shadow-2xl"
        >
            <div className="px-4 py-3 border-b border-border bg-muted/40 flex items-center justify-between">
              <DialogTitle className="text-sm font-bold text-foreground">
                {editingRegex?.id?.startsWith("reg_") ? t("regex.modal_new") : t("regex.modal_edit")}
              </DialogTitle>
              <button
                type="button"
                onClick={closeRegexModal}
                className="min-h-11 rounded-lg px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {t("regex.modal_close")}
              </button>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto max-h-[70vh]">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground block">{t("regex.modal_name")}</label>
                <Input
                  value={editingRegex?.scriptName || ""}
                  onChange={(e) =>
                    setEditingRegex((prev) => prev ? ({ ...prev, scriptName: e.target.value }) : prev)
                  }
                  placeholder={t("regex.modal_name_placeholder")}
                  className="h-11 text-xs bg-input/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground block">{t("regex.modal_find")}</label>
                <Input
                  value={editingRegex?.findRegex || ""}
                  onChange={(e) =>
                    setEditingRegex((prev) => prev ? ({ ...prev, findRegex: e.target.value }) : prev)
                  }
                  placeholder={t("regex.modal_find_placeholder")}
                  className="h-11 text-xs font-mono bg-input/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground block">{t("regex.modal_replace")}</label>
                <Input
                  value={editingRegex?.replaceString || ""}
                  onChange={(e) =>
                    setEditingRegex((prev) => prev ? ({ ...prev, replaceString: e.target.value }) : prev)
                  }
                  placeholder={t("regex.modal_replace_placeholder")}
                  className="h-11 text-xs bg-input/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground block">{t("regex.modal_placement")}</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                    <Checkbox
                      checked={editingRegex?.placement?.includes(1) || false}
                      onCheckedChange={(checked) => {
                        const current: number[] = editingRegex?.placement || [2];
                        let next;
                        if (checked) {
                          next = [...current.filter((value) => value !== 1), 1];
                        } else {
                          next = current.filter((value) => value !== 1);
                        }
                        setEditingRegex((prev) => prev ? ({ ...prev, placement: next }) : prev);
                      }}
                    />
                    {t("regex.modal_placement_input")}
                  </label>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                    <Checkbox
                      checked={editingRegex?.placement?.includes(2) || false}
                      onCheckedChange={(checked) => {
                        const current: number[] = editingRegex?.placement || [2];
                        let next;
                        if (checked) {
                          next = [...current.filter((value) => value !== 2), 2];
                        } else {
                          next = current.filter((value) => value !== 2);
                        }
                        setEditingRegex((prev) => prev ? ({ ...prev, placement: next }) : prev);
                      }}
                    />
                    {t("regex.modal_placement_output")}
                  </label>
                </div>
              </div>

              {/* 高级选项折叠栏 */}
              <div className="pt-2 border-t border-border/50">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((prev) => !prev)}
                  className="flex items-center justify-between w-full text-xs font-semibold text-muted-foreground hover:text-foreground transition py-1"
                >
                  <span className="flex items-center gap-1.5">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-primary" />
                    高级匹配与安全选项
                  </span>
                  {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>

                {showAdvanced && (
                  <div className="mt-3 space-y-3 p-2.5 rounded-lg bg-muted/30 border border-border/40 text-xs animate-fadeIn">
                    {/* 宏替换模式 */}
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-muted-foreground block">
                        宏参数替换与安全转义 (substituteRegex)
                      </label>
                      <select
                        value={editingRegex?.substituteRegex ?? 2}
                        onChange={(e) =>
                          setEditingRegex((prev) => prev ? ({ ...prev, substituteRegex: Number(e.target.value) }) : prev)
                        }
                        className="w-full h-8 px-2 text-xs rounded border border-border bg-background text-foreground"
                      >
                        <option value={2}>安全转义模式 (推荐，自动转义角色名中的正则元字符)</option>
                        <option value={1}>原始替换模式 (RAW，直接替换 {"{{char}}"} / {"{{user}}"})</option>
                        <option value={0}>不处理宏 (NONE，保持原始字面量)</option>
                      </select>
                    </div>

                    {/* 阶段开关 */}
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-muted-foreground block">执行时机</label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="flex items-center gap-1.5 text-muted-foreground cursor-pointer select-none">
                          <Checkbox
                            checked={Boolean(editingRegex?.markdownOnly)}
                            onCheckedChange={(checked) =>
                              setEditingRegex((prev) => prev ? ({ ...prev, markdownOnly: Boolean(checked) }) : prev)
                            }
                          />
                          仅渲染时生效 (markdownOnly)
                        </label>
                        <label className="flex items-center gap-1.5 text-muted-foreground cursor-pointer select-none">
                          <Checkbox
                            checked={Boolean(editingRegex?.promptOnly)}
                            onCheckedChange={(checked) =>
                              setEditingRegex((prev) => prev ? ({ ...prev, promptOnly: Boolean(checked) }) : prev)
                            }
                          />
                          仅发送时生效 (promptOnly)
                        </label>
                        <label className="flex items-center gap-1.5 text-muted-foreground cursor-pointer select-none col-span-2">
                          <Checkbox
                            checked={editingRegex?.runOnEdit !== false}
                            onCheckedChange={(checked) =>
                              setEditingRegex((prev) => prev ? ({ ...prev, runOnEdit: Boolean(checked) }) : prev)
                            }
                          />
                          编辑消息时重新执行 (runOnEdit)
                        </label>
                      </div>
                    </div>

                    {/* 深度范围 */}
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-muted-foreground block">
                        消息深度范围 (留空为全部生效)
                      </label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          placeholder="最小深度 (minDepth)"
                          value={editingRegex?.minDepth ?? ""}
                          onChange={(e) => {
                            const v = e.target.value === "" ? null : Number(e.target.value);
                            setEditingRegex((prev) => prev ? ({ ...prev, minDepth: v }) : prev);
                          }}
                          className="h-8 text-xs bg-background"
                        />
                        <span className="text-muted-foreground">~</span>
                        <Input
                          type="number"
                          placeholder="最大深度 (maxDepth)"
                          value={editingRegex?.maxDepth ?? ""}
                          onChange={(e) => {
                            const v = e.target.value === "" ? null : Number(e.target.value);
                            setEditingRegex((prev) => prev ? ({ ...prev, maxDepth: v }) : prev);
                          }}
                          className="h-8 text-xs bg-background"
                        />
                      </div>
                    </div>

                    {/* 裁剪关键词 trimStrings */}
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-muted-foreground block">
                        捕获组修剪文本 (trimStrings，英文逗号分隔)
                      </label>
                      <Input
                        placeholder="如: SECRET, [Private], //note"
                        value={(editingRegex?.trimStrings ?? []).join(", ")}
                        onChange={(e) => {
                          const list = e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean);
                          setEditingRegex((prev) => prev ? ({ ...prev, trimStrings: list }) : prev);
                        }}
                        className="h-8 text-xs bg-background font-mono"
                      />
                    </div>

                    {/* 扩展生效位置 */}
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-muted-foreground block">
                        扩展生效位置 (Placement)
                      </label>
                      <div className="flex flex-wrap gap-3">
                        <label className="flex items-center gap-1.5 text-muted-foreground cursor-pointer select-none">
                          <Checkbox
                            checked={editingRegex?.placement?.includes(6) || false}
                            onCheckedChange={(checked) => {
                              const current: number[] = editingRegex?.placement || [2];
                              const next = checked ? [...current.filter((v) => v !== 6), 6] : current.filter((v) => v !== 6);
                              setEditingRegex((prev) => prev ? ({ ...prev, placement: next }) : prev);
                            }}
                          />
                          思维链 (6)
                        </label>
                        <label className="flex items-center gap-1.5 text-muted-foreground cursor-pointer select-none">
                          <Checkbox
                            checked={editingRegex?.placement?.includes(5) || false}
                            onCheckedChange={(checked) => {
                              const current: number[] = editingRegex?.placement || [2];
                              const next = checked ? [...current.filter((v) => v !== 5), 5] : current.filter((v) => v !== 5);
                              setEditingRegex((prev) => prev ? ({ ...prev, placement: next }) : prev);
                            }}
                          />
                          世界书 (5)
                        </label>
                        <label className="flex items-center gap-1.5 text-muted-foreground cursor-pointer select-none">
                          <Checkbox
                            checked={editingRegex?.placement?.includes(3) || false}
                            onCheckedChange={(checked) => {
                              const current: number[] = editingRegex?.placement || [2];
                              const next = checked ? [...current.filter((v) => v !== 3), 3] : current.filter((v) => v !== 3);
                              setEditingRegex((prev) => prev ? ({ ...prev, placement: next }) : prev);
                            }}
                          />
                          斜杠命令 (3)
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="px-4 py-3 border-t border-border bg-muted/20 flex gap-2 justify-end">
              <button
                type="button"
                onClick={closeRegexModal}
                className="min-h-11 rounded-md border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-muted"
              >
                {t("prompts.cancel")}
              </button>
              <button
                type="button"
                disabled={!editingRegex}
                onClick={() => { if (editingRegex) void saveRegex(editingRegex); }}
                className="min-h-11 rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {t("regex.modal_save")}
              </button>
            </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
