import React from "react";
import { Save } from "lucide-react";
import type { EditFormState } from "./useWorldbookActions";
import type { LorebookEntry } from "../../types";

export interface InlineEntryFormProps {
  id: string;
  editForm: EditFormState;
  setEditForm: React.Dispatch<React.SetStateAction<EditFormState>>;
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>;
  onSave: (id: string) => Promise<void>;
}

/**
 * 内联编辑 / 新建世界设定条目表单组件。
 *
 * 对应原 GlobalWorldbookTab 内部 `renderInlineForm` 函数：
 * 包含基础信息（标题 / 关键词）、叙事内容、匹配规则、高级触发条件与动作按钮。
 */
export default function InlineEntryForm({
  id,
  editForm,
  setEditForm,
  setEditingId,
  onSave,
}: InlineEntryFormProps) {
  const safeRenderKeys = (keys: any): string => {
    if (Array.isArray(keys)) {
      return keys
        .map((k) => (typeof k === "string" ? k : String(k || "")))
        .join(", ");
    }
    if (typeof keys === "string") {
      return keys;
    }
    if (keys && typeof keys === "object") {
      try {
        return Object.values(keys)
          .map((v) => String(v || ""))
          .join(", ");
      } catch (e) {
        return "";
      }
    }
    return String(keys || "");
  };

  return (
    <div className="space-y-3.5 text-xs animate-fadeIn">
      {/* 基础：标题备注 + 触发唤醒词 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] text-muted-foreground mb-1 font-bold">
            设定标题或备注名称 *
          </label>
          <input
            type="text"
            placeholder="例如: 契约魔法, 隐秘圣堂"
            value={editForm.comment || ""}
            onChange={(e) =>
              setEditForm((prev) => ({ ...prev, comment: e.target.value }))
            }
            className="w-full bg-input border border-border rounded-lg p-2 text-foreground outline-none focus:border-primary font-medium transition"
          />
        </div>
        <div>
          <label className="block text-[11px] text-muted-foreground mb-1 font-bold">
            触发唤醒词 (半角逗号间隔拼写)
          </label>
          <input
            type="text"
            placeholder="契约, 咒印, 终焉"
            value={safeRenderKeys(editForm.keys)}
            onChange={(e) =>
              setEditForm((prev) => ({
                ...prev,
                keys: e.target.value as unknown as string[],
              }))
            }
            className="w-full bg-input border border-border rounded-lg p-2 text-foreground outline-none focus:border-primary font-medium transition"
          />
        </div>
      </div>

      {/* 叙事描述 */}
      <div>
        <label className="block text-[11px] text-muted-foreground mb-1 font-bold">
          设定补充叙述具体事实叙事内容 *
        </label>
        <textarea
          placeholder="具体的记忆描述。当对话中触发关键词时，系统会自动提取拼混入 AI 对局 Prompt 内。例如：契约魔法源自古尔德大王，施法时需要在掌心画出五角芒芒印，且饮下一滴生灵血..."
          rows={8}
          value={editForm.content || ""}
          onChange={(e) =>
            setEditForm((prev) => ({ ...prev, content: e.target.value }))
          }
          className="w-full bg-input border border-border rounded-lg p-2 text-foreground outline-none focus:border-primary resize-y leading-relaxed font-medium transition text-sm"
        />
      </div>

      {/* 匹配规则设置 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 border border-border/40 p-2 rounded-lg bg-muted/10">
        <label className="flex items-center gap-1.5 text-muted-foreground text-[10.5px] cursor-pointer">
          <input
            type="checkbox"
            checked={!!editForm.useRegex}
            onChange={(e) =>
              setEditForm((prev) => ({ ...prev, useRegex: e.target.checked }))
            }
            className="accent-primary"
          />
          <span>启用正则匹配 (Regex)</span>
        </label>
        <label className="flex items-center gap-1.5 text-muted-foreground text-[10.5px] cursor-pointer">
          <input
            type="checkbox"
            checked={!!editForm.addMemo}
            onChange={(e) =>
              setEditForm((prev) => ({ ...prev, addMemo: e.target.checked }))
            }
            className="accent-primary"
          />
          <span>合并包含标题别名</span>
        </label>
        <label className="flex items-center gap-1.5 text-muted-foreground text-[10.5px] cursor-pointer">
          <input
            type="checkbox"
            checked={!!editForm.constant}
            onChange={(e) =>
              setEditForm((prev) => ({ ...prev, constant: e.target.checked }))
            }
            className="accent-primary"
          />
          <span>常驻强制注入设定</span>
        </label>
        <label className="flex items-center gap-1.5 text-rose-500 text-[10.5px] cursor-pointer">
          <input
            type="checkbox"
            checked={!!editForm.disabled}
            onChange={(e) =>
              setEditForm((prev) => ({ ...prev, disabled: e.target.checked }))
            }
            className="accent-primary"
          />
          <span className="font-semibold">临时禁用本条词</span>
        </label>
      </div>

      {/* 高级触发条件 */}
      <div className="border-t border-border/50 pt-2.5 space-y-2">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          <div>
            <label className="block text-[10px] text-muted-foreground mb-1">
              插入位置 (Position)
            </label>
            <select
              value={editForm.position || "after_char_def"}
              onChange={(e) =>
                setEditForm((prev) => ({
                  ...prev,
                  position: e.target.value as LorebookEntry["position"],
                }))
              }
              className="w-full bg-input border border-border rounded-lg p-1.5 text-foreground text-xs"
            >
              <option value="after_char_def">📌 角色定义之后</option>
              <option value="before_char_def">📌 角色定义之前</option>
              <option value="top">📌 对话最顶部</option>
              <option value="before_last_mes">💬 最新发言上方</option>
              <option value="in_chat">💬 历史对话中 (按深度)</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-muted-foreground mb-1">
              检索后推深度 (Depth)
            </label>
            <input
              type="number"
              min={1}
              value={editForm.depth !== undefined ? editForm.depth : 4}
              onChange={(e) =>
                setEditForm((prev) => ({
                  ...prev,
                  depth: Number(e.target.value),
                }))
              }
              className="w-full bg-input border border-border rounded-lg p-1.5 text-foreground text-xs font-semibold"
            />
          </div>
          <div>
            <label className="block text-[10px] text-muted-foreground mb-1">
              编排权重次序 (Order)
            </label>
            <input
              type="number"
              value={editForm.order !== undefined ? editForm.order : 100}
              onChange={(e) =>
                setEditForm((prev) => ({
                  ...prev,
                  order: Number(e.target.value),
                }))
              }
              className="w-full bg-input border border-border rounded-lg p-1.5 text-foreground text-xs font-semibold"
            />
          </div>
          <div>
            <label className="block text-[10px] text-muted-foreground mb-1">
              唤起触发概率 (%)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={
                editForm.probability !== undefined ? editForm.probability : 100
              }
              onChange={(e) =>
                setEditForm((prev) => ({
                  ...prev,
                  probability: Number(e.target.value),
                }))
              }
              className="w-full bg-input border border-border rounded-lg p-1.5 text-foreground text-xs font-semibold"
            />
          </div>
        </div>
      </div>

      {/* 表单内动作按钮 */}
      <div className="flex items-center justify-end gap-2 border-t border-border/40 pt-2.5 font-sans">
        <button
          onClick={() => {
            setEditingId(null);
            setEditForm({});
          }}
          type="button"
          className="bg-muted hover:bg-muted/80 active:scale-[0.98] text-muted-foreground px-3.5 py-1.5 rounded-lg text-xs font-semibold transition font-sans"
        >
          取消
        </button>
        <button
          onClick={() => onSave(id)}
          disabled={!editForm.content?.trim()}
          type="button"
          className="bg-primary hover:bg-primary/95 disabled:opacity-45 text-primary-foreground px-4 py-1.5 rounded-lg text-xs font-bold transition active:scale-[0.98] flex items-center gap-1 shadow-sm font-sans"
        >
          <Save className="w-3.5 h-3.5" />
          <span>保存世界设定</span>
        </button>
      </div>
    </div>
  );
}
