import { useState, type Dispatch, type SetStateAction } from "react";
import { ChevronDown, ChevronUp, SlidersHorizontal } from "lucide-react";
import { Checkbox } from "../../../components/ui/checkbox";
import { Input } from "../../../components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "../../../components/ui/dialog";
import { useTranslation } from "../../contexts/LanguageContext";
import { useMobileBackHandler } from "../../hooks/useMobileBackHandler";
import type { EditableRegexScript, usePresetFormState } from "./usePresetFormState";

/** 与 usePresetFormState 对外暴露的保存能力同型，避免在此重复声明函数签名。 */
type PresetFormApi = ReturnType<typeof usePresetFormState>;

interface RegexEditorDialogProps {
  editingRegex: EditableRegexScript | null;
  setEditingRegex: Dispatch<SetStateAction<EditableRegexScript | null>>;
  isRegexModalOpen: boolean;
  setIsRegexModalOpen: Dispatch<SetStateAction<boolean>>;
  saveRegex: PresetFormApi["saveRegex"];
}

/**
 * 新建 / 编辑正则脚本 Modal。
 *
 * 自 RegexManagementSection 拆出以控制单文件行数：同一 Dialog / DialogContent /
 * DialogTitle、同一 useMobileBackHandler、同一保存口径，交互与文案保持不变。
 */
export default function RegexEditorDialog({
  editingRegex,
  setEditingRegex,
  isRegexModalOpen,
  setIsRegexModalOpen,
  saveRegex,
}: RegexEditorDialogProps) {
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
                    let next: number[];
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
                    let next: number[];
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
                {t("regex.modal_advanced_toggle")}
              </span>
              {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-3 p-2.5 rounded-lg bg-muted/30 border border-border/40 text-xs animate-fadeIn">
                {/* 宏替换模式 */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-muted-foreground block">
                    {t("regex.modal_advanced_substitute")}
                  </label>
                  {/* 默认值必须与运行期一致：正则引擎在字段缺失时按 RAW(1) 处理，
                      显示 2 会造成"界面承诺安全转义、实际按原始替换执行"。 */}
                  <select
                    value={editingRegex?.substituteRegex ?? 1}
                    onChange={(e) =>
                      setEditingRegex((prev) => prev ? ({ ...prev, substituteRegex: Number(e.target.value) }) : prev)
                    }
                    className="w-full h-8 px-2 text-xs rounded border border-border bg-background text-foreground"
                  >
                    <option value={2}>{t("regex.modal_advanced_substitute_escaped")}</option>
                    <option value={1}>{t("regex.modal_advanced_substitute_raw")}</option>
                    <option value={0}>{t("regex.modal_advanced_substitute_none")}</option>
                  </select>
                </div>

                {/* 阶段开关 */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-muted-foreground block">{t("regex.modal_advanced_phase")}</label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-1.5 text-muted-foreground cursor-pointer select-none">
                      <Checkbox
                        checked={Boolean(editingRegex?.markdownOnly)}
                        onCheckedChange={(checked) =>
                          setEditingRegex((prev) => prev ? ({ ...prev, markdownOnly: Boolean(checked) }) : prev)
                        }
                      />
                      {t("regex.modal_advanced_markdown_only")}
                    </label>
                    <label className="flex items-center gap-1.5 text-muted-foreground cursor-pointer select-none">
                      <Checkbox
                        checked={Boolean(editingRegex?.promptOnly)}
                        onCheckedChange={(checked) =>
                          setEditingRegex((prev) => prev ? ({ ...prev, promptOnly: Boolean(checked) }) : prev)
                        }
                      />
                      {t("regex.modal_advanced_prompt_only")}
                    </label>
                    <label className="flex items-center gap-1.5 text-muted-foreground cursor-pointer select-none col-span-2">
                      <Checkbox
                        checked={editingRegex?.runOnEdit !== false}
                        onCheckedChange={(checked) =>
                          setEditingRegex((prev) => prev ? ({ ...prev, runOnEdit: Boolean(checked) }) : prev)
                        }
                      />
                      {t("regex.modal_advanced_run_on_edit")}
                    </label>
                  </div>
                </div>

                {/* 深度范围 */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-muted-foreground block">
                    {t("regex.modal_advanced_depth")}
                  </label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      placeholder={t("regex.modal_advanced_min_depth")}
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
                      placeholder={t("regex.modal_advanced_max_depth")}
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
                    {t("regex.modal_advanced_trim")}
                  </label>
                  {/* 非受控输入：值由开放时的草稿决定，中途敲下的逗号不会被同一次渲染吃掉
                      （旧实现每次 onChange 都 split/join，导致逗号分隔的第二项无法键入）。 */}
                  <Input
                    key={editingRegex?.id ?? "new-regex"}
                    placeholder={t("regex.modal_advanced_trim_placeholder")}
                    defaultValue={(editingRegex?.trimStrings ?? []).join(", ")}
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
                    {t("regex.modal_advanced_placement")}
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
                      {t("regex.modal_advanced_placement_chain")}
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
                      {t("regex.modal_advanced_placement_worldbook")}
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
                      {t("regex.modal_advanced_placement_command")}
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
  );
}
