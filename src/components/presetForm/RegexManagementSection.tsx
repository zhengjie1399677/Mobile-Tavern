import { Sparkles, ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../../components/ui/card";
import { useTranslation } from "../../contexts/LanguageContext";
import { Switch } from "../../../components/ui/switch";
import { Checkbox } from "../../../components/ui/checkbox";
import { Input } from "../../../components/ui/input";
import { cn } from "../../../lib/utils";
import type { UserSettings, CharacterCard } from "../../types";

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
  editingRegex: any;
  setEditingRegex: (value: any) => void;
  isRegexModalOpen: boolean;
  setIsRegexModalOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  toggleRegexDisabled: (id: string, disabled: boolean, scope: "global" | "preset" | "character") => void;
  deleteRegex: (id: string, name: string, scope: "global" | "preset" | "character") => Promise<void>;
  saveRegex: (reg: any) => void;
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
  return (
    <>
      <Card className={cn("glass-panel shadow-sm transition-all duration-300", isRegexFolded ? "py-2 gap-0" : "")}>
        <CardHeader
          className={cn("cursor-pointer hover:bg-muted/20 transition select-none", isRegexFolded ? "pb-0 border-b-0" : "pb-3 border-b border-border/50")}
          onClick={handleToggleRegexFold}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2 shrink-0">
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
            <CardDescription className="text-[11px] mt-1">
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
                        <span className="text-[8px] font-semibold px-1 py-0.2 border border-border/80 rounded bg-background text-muted-foreground">
                          {r.placement?.includes(1) && r.placement?.includes(2)
                            ? t("regex.placement_both")
                            : r.placement?.includes(1)
                            ? t("regex.placement_input")
                            : t("regex.placement_output")}
                        </span>
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
                        <span className="text-[8px] font-semibold px-1 py-0.2 border border-border/80 rounded bg-background text-muted-foreground">
                          {r.placement?.includes(1) && r.placement?.includes(2)
                            ? t("regex.placement_both")
                            : r.placement?.includes(1)
                            ? t("regex.placement_input")
                            : t("regex.placement_output")}
                        </span>
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
                {activeCharacter.extensions.regex_scripts.map((r: any) => {
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
                          <span className="text-[8px] font-semibold px-1 py-0.2 border border-border/80 rounded bg-background text-muted-foreground">
                            {r.placement?.includes(1) && r.placement?.includes(2)
                              ? t("regex.placement_both")
                              : r.placement?.includes(1)
                              ? t("regex.placement_input")
                              : t("regex.placement_output")}
                          </span>
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
      {isRegexModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-background border border-border rounded-xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col">
            <div className="px-4 py-3 border-b border-border bg-muted/40 flex items-center justify-between">
              <p className="text-sm font-bold text-foreground">
                {editingRegex?.id?.startsWith("reg_") ? t("regex.modal_new") : t("regex.modal_edit")}
              </p>
              <button
                onClick={() => {
                  setIsRegexModalOpen(false);
                  setEditingRegex(null);
                }}
                className="text-xs text-muted-foreground hover:text-foreground transition font-semibold"
              >
                {t("regex.modal_close")}
              </button>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto max-h-[70vh]">
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-muted-foreground block">{t("regex.modal_name")}</label>
                <Input
                  value={editingRegex?.scriptName || ""}
                  onChange={(e) =>
                    setEditingRegex((prev: any) => ({ ...prev, scriptName: e.target.value }))
                  }
                  placeholder={t("regex.modal_name_placeholder")}
                  className="h-9 text-xs bg-input/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-muted-foreground block">{t("regex.modal_find")}</label>
                <Input
                  value={editingRegex?.findRegex || ""}
                  onChange={(e) =>
                    setEditingRegex((prev: any) => ({ ...prev, findRegex: e.target.value }))
                  }
                  placeholder={t("regex.modal_find_placeholder")}
                  className="h-9 text-xs font-mono bg-input/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-muted-foreground block">{t("regex.modal_replace")}</label>
                <Input
                  value={editingRegex?.replaceString || ""}
                  onChange={(e) =>
                    setEditingRegex((prev: any) => ({ ...prev, replaceString: e.target.value }))
                  }
                  placeholder={t("regex.modal_replace_placeholder")}
                  className="h-9 text-xs bg-input/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-muted-foreground block">{t("regex.modal_placement")}</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                    <Checkbox
                      checked={editingRegex?.placement?.includes(1) || false}
                      onCheckedChange={(checked) => {
                        const current = editingRegex?.placement || [2];
                        let next;
                        if (checked) {
                          next = [...current.filter((x: any) => x !== 1), 1];
                        } else {
                          next = current.filter((x: any) => x !== 1);
                        }
                        setEditingRegex((prev: any) => ({ ...prev, placement: next }));
                      }}
                    />
                    {t("regex.modal_placement_input")}
                  </label>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                    <Checkbox
                      checked={editingRegex?.placement?.includes(2) || false}
                      onCheckedChange={(checked) => {
                        const current = editingRegex?.placement || [2];
                        let next;
                        if (checked) {
                          next = [...current.filter((x: any) => x !== 2), 2];
                        } else {
                          next = current.filter((x: any) => x !== 2);
                        }
                        setEditingRegex((prev: any) => ({ ...prev, placement: next }));
                      }}
                    />
                    {t("regex.modal_placement_output")}
                  </label>
                </div>
              </div>
            </div>
            <div className="px-4 py-3 border-t border-border bg-muted/20 flex gap-2 justify-end">
              <button
                onClick={() => {
                  setIsRegexModalOpen(false);
                  setEditingRegex(null);
                }}
                className="px-3 py-1.5 text-xs font-medium border border-border bg-background hover:bg-muted rounded-md transition"
              >
                {t("prompts.cancel")}
              </button>
              <button
                onClick={() => saveRegex(editingRegex)}
                className="px-4 py-1.5 text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 rounded-md transition"
              >
                {t("regex.modal_save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}