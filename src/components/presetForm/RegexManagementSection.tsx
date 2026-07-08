import { Sparkles, ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../../components/ui/card";
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
  return (
    <>
      <Card className={cn("glass-panel shadow-sm transition-all duration-300", isRegexFolded ? "py-2 gap-0" : "")}>
        <CardHeader
          className={cn("cursor-pointer hover:bg-muted/20 transition select-none", isRegexFolded ? "pb-0 border-b-0" : "pb-3 border-b border-border/50")}
          onClick={handleToggleRegexFold}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2 shrink-0">
              <Sparkles className="w-4 h-4 text-primary" /> 正则过滤脚本管理
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
              配置全局和预设专属正则表达式过滤规则，在发送或展示前对文本进行净化
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
                  🌌 全局正则脚本 (Global Regex)
                </span>
                <span className="text-[9.5px] text-muted-foreground block">
                  对所有角色和所有预设生效，保存在全局设置中
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
                      <Trash2 className="w-3 h-3" /> 确认删除 ({selectedGlobalRegexIds.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsBatchDeletingGlobalRegex(false);
                        setSelectedGlobalRegexIds([]);
                      }}
                      className="text-[10px] font-bold text-muted-foreground bg-muted hover:bg-muted/80 px-2 py-1 border border-border flex items-center gap-1 transition tap-scale"
                    >
                      取消
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
                        批量删除
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
                      <Plus className="w-2.5 h-2.5" /> 新建全局
                    </button>
                  </>
                )}
              </div>
            </div>

            {(!settings.globalRegexScripts || settings.globalRegexScripts.length === 0) ? (
              <div className="border border-dashed border-border/50 rounded-xl p-4 text-center text-muted-foreground flex flex-col items-center justify-center gap-1.5">
                <span className="text-[10px] font-light text-muted-foreground/60 leading-relaxed">
                  暂无全局正则脚本，可手动新建过滤 {"<think>"} 标签。
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
                            ? "双向"
                            : r.placement?.includes(1)
                            ? "输入"
                            : "输出"}
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
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteRegex(r.id, r.scriptName, "global")}
                        className="text-[9px] text-rose-500 hover:text-rose-700 transition font-semibold px-1.5 py-0.5 rounded hover:bg-rose-950/20"
                      >
                        删除
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
                  📋 预设专属正则 (Preset Regex)
                </span>
                <span className="text-[9.5px] text-muted-foreground block">
                  仅在当前预设 [{settings.preset.name}] 激活时生效，随预设一同保存导出
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
                      <Trash2 className="w-3 h-3" /> 确认删除 ({selectedPresetRegexIds.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsBatchDeletingPresetRegex(false);
                        setSelectedPresetRegexIds([]);
                      }}
                      className="text-[10px] font-bold text-muted-foreground bg-muted hover:bg-muted/80 px-2 py-1 border border-border flex items-center gap-1 transition tap-scale"
                    >
                      取消
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
                        批量删除
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
                      <Plus className="w-2.5 h-2.5" /> 新建预设
                    </button>
                  </>
                )}
              </div>
            </div>

            {(!settings.presetRegexScripts || settings.presetRegexScripts.length === 0) ? (
              <div className="border border-dashed border-border/50 rounded-xl p-4 text-center text-muted-foreground flex flex-col items-center justify-center gap-1.5">
                <span className="text-[10px] font-light text-muted-foreground/60 leading-relaxed">
                  暂无预设专属正则脚本，导入预设时会自动解析导入。
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
                            ? "双向"
                            : r.placement?.includes(1)
                            ? "输入"
                            : "输出"}
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
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteRegex(r.id, r.scriptName, "preset")}
                        className="text-[9px] text-rose-500 hover:text-rose-700 transition font-semibold px-1.5 py-0.5 rounded hover:bg-rose-950/20"
                      >
                        删除
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
                  🎭 活跃角色专属局部正则 (Character Local Regex)
                </span>
                <span className="text-[9.5px] text-muted-foreground block">
                  仅当活跃角色 [{activeCharacter?.name || "未选择"}] 开启时生效，直接保存修改至角色卡中
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
                  <Plus className="w-2.5 h-2.5" /> 新建角色
                </button>
              )}
            </div>

            {(!activeCharacter || !activeCharacter.extensions?.regex_scripts || activeCharacter.extensions.regex_scripts.length === 0) ? (
              <div className="border border-dashed border-border/50 rounded-xl p-4 text-center text-muted-foreground flex flex-col items-center justify-center gap-1.5">
                <span className="text-[10px] font-light text-muted-foreground/60 leading-relaxed">
                  当前角色暂无专属局部正则。可点击上方按钮手动新建角色专属过滤。
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
                              ? "双向"
                              : r.placement?.includes(1)
                              ? "输入"
                              : "输出"}
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
                          编辑
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteRegex(targetId, r.scriptName, "character")}
                          className="text-[9px] text-rose-500 hover:text-rose-700 transition font-semibold px-1.5 py-0.5 rounded hover:bg-rose-950/20"
                        >
                          删除
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
                {editingRegex?.id?.startsWith("reg_") ? "新建正则脚本" : "编辑正则脚本"}
              </p>
              <button
                onClick={() => {
                  setIsRegexModalOpen(false);
                  setEditingRegex(null);
                }}
                className="text-xs text-muted-foreground hover:text-foreground transition font-semibold"
              >
                关闭
              </button>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto max-h-[70vh]">
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-muted-foreground block">脚本名称</label>
                <Input
                  value={editingRegex?.scriptName || ""}
                  onChange={(e) =>
                    setEditingRegex((prev: any) => ({ ...prev, scriptName: e.target.value }))
                  }
                  placeholder="例如：隐藏思维链"
                  className="h-9 text-xs bg-input/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-muted-foreground block">匹配正则表达式 (支持 /pattern/flags 格式)</label>
                <Input
                  value={editingRegex?.findRegex || ""}
                  onChange={(e) =>
                    setEditingRegex((prev: any) => ({ ...prev, findRegex: e.target.value }))
                  }
                  placeholder="例如：/<think>[\s\S]*?<\/think>/gi"
                  className="h-9 text-xs font-mono bg-input/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-muted-foreground block">替换文本 (可以使用 $1, $2 占位符)</label>
                <Input
                  value={editingRegex?.replaceString || ""}
                  onChange={(e) =>
                    setEditingRegex((prev: any) => ({ ...prev, replaceString: e.target.value }))
                  }
                  placeholder="例如：（留空代表直接删除匹配内容）"
                  className="h-9 text-xs bg-input/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-muted-foreground block">作用阶段 (Placement)</label>
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
                    输入阶段 (拦截发送)
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
                    输出阶段 (渲染渲染)
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
                取消
              </button>
              <button
                onClick={() => saveRegex(editingRegex)}
                className="px-4 py-1.5 text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 rounded-md transition"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}