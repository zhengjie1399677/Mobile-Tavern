import { Sparkles, ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Card, CardHeader, CardContent } from "../../../components/ui/card";
import { useTranslation, type LanguageContextProps } from "../../contexts/LanguageContext";
import { Switch } from "../../../components/ui/switch";
import { Checkbox } from "../../../components/ui/checkbox";
import { cn } from "../../../lib/utils";
import type { Dispatch, SetStateAction } from "react";
import type { UserSettings, CharacterCard, RegexScript } from "../../types";
import type { EditableRegexScript } from "./usePresetFormState";
import RegexEditorDialog from "./RegexEditorDialog";
import { regexScriptKey, normalizeRegexScripts } from "../../domain/regex/regexScriptIdentity";

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

function renderRuleBadges(r: RegexScript, t: LanguageContextProps["t"]) {
  const placement = r.placement;
  let placementText = t("regex.placement_output");
  if (placement && placement.length > 0) {
    const tags: string[] = [];
    if (placement.includes(1)) tags.push(t("regex.placement_input"));
    if (placement.includes(2)) tags.push(t("regex.placement_output"));
    if (placement.includes(6)) tags.push(t("regex.placement_chain"));
    if (placement.includes(5)) tags.push(t("regex.placement_worldbook"));
    if (placement.includes(3)) tags.push(t("regex.placement_command"));
    placementText = tags.join("·") || t("regex.placement_output");
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[8px] font-semibold px-1 py-0.2 border border-border/80 rounded bg-background text-muted-foreground">
        {placementText}
      </span>
      {r.markdownOnly && (
        <span className="text-[8px] font-semibold px-1 py-0.2 border border-primary/30 rounded bg-primary/10 text-primary">
          {t("regex.badge_markdown_only")}
        </span>
      )}
      {r.promptOnly && (
        <span className="text-[8px] font-semibold px-1 py-0.2 border border-amber-500/30 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
          {t("regex.badge_prompt_only")}
        </span>
      )}
      {r.substituteRegex === 2 && (
        <span className="text-[8px] font-semibold px-1 py-0.2 border border-emerald-500/30 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          {t("regex.badge_safe_escape")}
        </span>
      )}
      {((r.minDepth !== undefined && r.minDepth !== null) || (r.maxDepth !== undefined && r.maxDepth !== null)) && (
        <span className="text-[8px] font-semibold px-1 py-0.2 border border-border rounded bg-muted/60 text-muted-foreground font-mono">
          {t("regex.badge_depth", { min: r.minDepth ?? 0, max: r.maxDepth ?? "∞" })}
        </span>
      )}
      {r.trimStrings && r.trimStrings.length > 0 && (
        <span className="text-[8px] font-semibold px-1 py-0.2 border border-border rounded bg-muted/60 text-muted-foreground font-mono">
          {t("regex.badge_trim_count", { count: r.trimStrings.length })}
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
  // 角色轨正则是外部动态结构（数组或 {"0": {...}} 对象），统一归一后再消费，
  // 否则对象形态会让 `.filter/.map/.length` 抛错并带崩整个预设表单。
  const charRegexScripts = normalizeRegexScripts(activeCharacter?.extensions?.regex_scripts);

  return (
    <>
      <Card className={cn("glass-panel shadow-sm transition-all duration-300 rounded-2xl border border-border/60 bg-card/60 backdrop-blur-xs overflow-hidden", isRegexFolded ? "gap-0" : "")}>
        <CardHeader
          className={cn("cursor-pointer hover:bg-muted/20 transition select-none py-2.5 px-3.5", isRegexFolded ? "border-b-0" : "border-b border-border/30")}
          onClick={handleToggleRegexFold}
        >
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex items-center justify-center w-7.5 h-7.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shrink-0">
                <Sparkles className="w-4 h-4" />
              </span>
              <div className="flex flex-col items-start min-w-0">
                <span className="text-xs sm:text-[13px] font-semibold text-foreground shrink-0">
                  {t("regex.title")}
                </span>
                {!isRegexFolded && (
                  <span className="text-[10px] text-muted-foreground/75 font-normal truncate max-w-[150px] sm:max-w-none">
                    {t("regex.subtitle")}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 overflow-hidden">
              {isRegexFolded && (
                <span className="text-[10px] text-cyan-400 font-mono bg-cyan-500/10 px-2 py-0.5 rounded-full border border-cyan-500/20 truncate max-w-[150px] sm:max-w-none">
                  {t("regex.folded_summary", { global: activeGlobalRegex, preset: activePresetRegex, character: activeCharRegex })}
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
                {settings.globalRegexScripts.map((r) => {
                  // 与角色轨同口径：缺 id 的历史脚本用 scriptName 当身份，
                  // 否则 key/开关/删除/编辑会一起落到"所有缺 id 的脚本"上。
                  const targetId = regexScriptKey(r);
                  return (
                  <div
                    key={targetId}
                    className={`border border-border/40 rounded-lg p-2 bg-muted/10 flex items-center justify-between gap-3 transition ${
                      r.disabled ? "opacity-60" : ""
                    }`}
                  >
                    {isBatchDeletingGlobalRegex && (
                      <Checkbox
                        checked={selectedGlobalRegexIds.includes(targetId)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedGlobalRegexIds((prev) => [...prev, targetId]);
                          } else {
                            setSelectedGlobalRegexIds((prev) => prev.filter((id) => id !== targetId));
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
                        {r.findRegex} ➔ {r.replaceString === "" ? t("regex.replace_empty_delete") : r.replaceString}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 scale-90">
                      <Switch
                        aria-label={t("regex.aria_toggle_global", { name: r.scriptName })}
                        checked={!r.disabled}
                        onCheckedChange={(checked) => toggleRegexDisabled(targetId, !checked, "global")}
                        className="data-[state=checked]:bg-primary h-3 w-6 [&_span]:h-2 [&_span]:w-2"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setEditingRegex({ ...r, scope: "global", id: targetId });
                          setIsRegexModalOpen(true);
                        }}
                        className="text-[9px] text-muted-foreground hover:text-primary transition font-semibold px-1.5 py-0.5 rounded hover:bg-muted"
                      >
                        {t("regex.edit")}
                      </button>
                      <button
                        type="button"
                          onClick={() => deleteRegex(targetId, r.scriptName, "global")}
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
                {settings.presetRegexScripts.map((r) => {
                  // 与全局 / 角色轨同口径：缺 id 的历史脚本用 scriptName 当身份。
                  const targetId = regexScriptKey(r);
                  return (
                  <div
                    key={targetId}
                    className={`border border-border/40 rounded-lg p-2 bg-muted/10 flex items-center justify-between gap-3 transition ${
                      r.disabled ? "opacity-60" : ""
                    }`}
                  >
                    {isBatchDeletingPresetRegex && (
                      <Checkbox
                        checked={selectedPresetRegexIds.includes(targetId)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedPresetRegexIds((prev) => [...prev, targetId]);
                          } else {
                            setSelectedPresetRegexIds((prev) => prev.filter((id) => id !== targetId));
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
                        {r.findRegex} ➔ {r.replaceString === "" ? t("regex.replace_empty_delete") : r.replaceString}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 scale-90">
                      <Switch
                        aria-label={t("regex.aria_toggle_preset", { name: r.scriptName })}
                        checked={!r.disabled}
                        onCheckedChange={(checked) => toggleRegexDisabled(targetId, !checked, "preset")}
                        className="data-[state=checked]:bg-primary h-3 w-6 [&_span]:h-2 [&_span]:w-2"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setEditingRegex({ ...r, scope: "preset", id: targetId });
                          setIsRegexModalOpen(true);
                        }}
                        className="text-[9px] text-muted-foreground hover:text-primary transition font-semibold px-1.5 py-0.5 rounded hover:bg-muted"
                      >
                        {t("regex.edit")}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteRegex(targetId, r.scriptName, "preset")}
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

            {(charRegexScripts.length === 0) ? (
              <div className="border border-dashed border-border/50 rounded-xl p-4 text-center text-muted-foreground flex flex-col items-center justify-center gap-1.5">
                <span className="text-[10px] font-light text-muted-foreground/60 leading-relaxed">
                  {t("regex.no_char")}
                </span>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[160px] overflow-y-auto custom-scrollbar pr-1">
                {charRegexScripts.map((r: RegexScript) => {
                  // 与全局 / 预设轨同口径：缺 id 的历史脚本用 scriptName 当身份。
                  const targetId = regexScriptKey(r);
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
                          {r.findRegex} ➔ {r.replaceString === "" ? t("regex.replace_empty_delete") : r.replaceString}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 scale-90">
                        <Switch
                          aria-label={t("regex.aria_toggle_character", { name: r.scriptName })}
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

      {/* 新建/编辑正则 Modal 浮窗（已拆至 RegexEditorDialog） */}
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
