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
 * 「插入位置」各选项的直白解释。
 * 原先只写「角色前 / 角色后」，会被误读成「上一个 / 下一个角色」。
 * 这里统一说明：它指的是本条内容在角色卡设定区块的前面还是后面。
 */
const POSITION_HINTS: Record<NonNullable<LorebookEntry["position"]>, string> = {
  after_char_def: "本条内容排在角色描述 / 性格 / 场景的后面。",
  before_char_def: "本条内容排在角色描述 / 性格 / 场景的前面。",
  top: "本条内容排在整段提示词的最前面。",
  before_last_mes: "本条内容排在聊天记录末尾、最新一条发言之前。",
  in_chat: "本条内容按「检索后推深度」插入聊天记录内部。",
};

type PositionValue = NonNullable<LorebookEntry["position"]>;

/**
 * 插入位置的结构图行。提示词从上到下铺开，slot 是可点的插入点，
 * anchor 是角色卡设定本体，divider 只做区块分隔。
 */
type PositionRow =
  | { kind: "slot"; value: PositionValue; label: string }
  | { kind: "anchor"; label: string; caption: string }
  | { kind: "divider"; label: string };

const POSITION_ROWS: readonly PositionRow[] = [
  { kind: "slot", value: "top", label: "提示词最顶部" },
  { kind: "slot", value: "before_char_def", label: "角色卡设定之前" },
  { kind: "anchor", label: "角色卡设定", caption: "描述 · 性格 · 场景" },
  { kind: "slot", value: "after_char_def", label: "角色卡设定之后" },
  { kind: "divider", label: "聊天记录" },
  { kind: "slot", value: "in_chat", label: "历史对话中" },
  { kind: "slot", value: "before_last_mes", label: "最新一条发言之前" },
];

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
  const currentPosition = (editForm.position || "after_char_def") as PositionValue;
  const currentDepth = editForm.depth !== undefined ? editForm.depth : 4;

  const safeRenderKeys = (keys: unknown): string => {
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
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1">
            插入位置 (Position)
          </label>
          <div className="rounded-lg border border-border/60 bg-muted/20 px-2 py-1.5">
            <div className="relative pl-4">
              <span
                className="absolute left-1.5 top-2.5 bottom-2.5 w-px bg-border"
                aria-hidden="true"
              />
              {POSITION_ROWS.map((row, index) => {
                if (row.kind === "anchor") {
                  return (
                    <div
                      key={`anchor-${index}`}
                      className="my-0.5 rounded-md border border-border/60 bg-card/60 px-2 py-1"
                    >
                      <div className="text-[10.5px] font-semibold text-foreground">
                        {row.label}
                      </div>
                      <div className="text-[9.5px] text-muted-foreground">
                        {row.caption}
                      </div>
                    </div>
                  );
                }
                if (row.kind === "divider") {
                  return (
                    <div
                      key={`divider-${index}`}
                      className="flex items-center gap-1.5 px-2 py-0.5"
                    >
                      <span className="text-[9.5px] text-muted-foreground">
                        {row.label}
                      </span>
                      <span className="h-px flex-1 bg-border/60" />
                    </div>
                  );
                }
                const active = currentPosition === row.value;
                return (
                  <button
                    key={row.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setEditForm((prev) => ({ ...prev, position: row.value }))
                    }
                    className={`relative flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[10.5px] transition select-none ${
                      active
                        ? "bg-primary/15 text-foreground ring-1 ring-primary/50"
                        : "text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    <span
                      className={`absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full border ${
                        active ? "border-primary bg-primary" : "border-border bg-card"
                      }`}
                      style={{ left: "-13px" }}
                      aria-hidden="true"
                    />
                    <span className="flex-1 truncate">
                      {row.value === "in_chat"
                        ? `${row.label} · 深度 ${currentDepth}`
                        : row.label}
                    </span>
                    {active && (
                      <span className="shrink-0 rounded-full bg-primary px-1.5 py-[1px] text-[9px] font-semibold text-primary-foreground">
                        本条内容
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <p className="mt-1 text-[10px] leading-snug text-muted-foreground/80">
            {POSITION_HINTS[currentPosition]}
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
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
