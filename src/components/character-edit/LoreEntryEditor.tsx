import { LorebookEntry } from "../../types";

export interface LoreEntryEditorProps {
  editingLoreEntry: Partial<LorebookEntry> | null;
  setEditingLoreEntry: (entry: Partial<LorebookEntry> | null) => void;
  handleSaveLoreEntry: () => void;
}

export default function LoreEntryEditor({
  editingLoreEntry,
  setEditingLoreEntry,
  handleSaveLoreEntry,
}: LoreEntryEditorProps) {
  if (!editingLoreEntry) return null;
  return (
    <div className="space-y-3 text-xs bg-muted/20 p-3 rounded-lg border border-border">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1 font-bold">
            标题或备注 *
          </label>
          <input
            type="text"
            placeholder="例如: 契约魔力, 隐秘圣所"
            value={editingLoreEntry.comment || ""}
            onChange={(e) =>
              setEditingLoreEntry({
                ...editingLoreEntry,
                comment: e.target.value,
              })
            }
            className="w-full bg-input border border-border rounded p-1.5 text-foreground text-xs font-semibold outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="block text-[10px] text-muted-foreground mb-1 font-bold">
            检测关键词 (逗号隔离)
          </label>
          <input
            type="text"
            placeholder="魔力, 契约"
            value={
              editingLoreEntry.keys
                ? Array.isArray(editingLoreEntry.keys)
                  ? editingLoreEntry.keys.join(",")
                  : (editingLoreEntry.keys as unknown as string)
                : ""
            }
            onChange={(e) =>
              setEditingLoreEntry({
                ...editingLoreEntry,
                keys: e.target.value as unknown as string[],
              })
            }
            className="w-full bg-input border border-border rounded p-1.5 text-foreground text-xs font-semibold outline-none focus:border-primary"
          />
        </div>
      </div>
      <div>
        <label className="block text-[10px] text-muted-foreground mb-1 font-bold">
          设定集具体叙述内容 *
        </label>
        <textarea
          placeholder="描述具体的记忆事实段落..."
          rows={6}
          value={editingLoreEntry.content || ""}
          onChange={(e) =>
            setEditingLoreEntry({
              ...editingLoreEntry,
              content: e.target.value,
            })
          }
          className="w-full bg-input border border-border rounded p-2 text-foreground text-sm leading-relaxed outline-none focus:border-primary resize-y font-medium"
        />
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 p-1.5 bg-muted/20 border border-border/20 rounded">
        <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={!!editingLoreEntry.useRegex}
            onChange={(e) =>
              setEditingLoreEntry({
                ...editingLoreEntry,
                useRegex: e.target.checked,
              })
            }
            className="accent-primary"
          />
          <span>正则</span>
        </label>
        <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={!!editingLoreEntry.addMemo}
            onChange={(e) =>
              setEditingLoreEntry({
                ...editingLoreEntry,
                addMemo: e.target.checked,
              })
            }
            className="accent-primary"
          />
          <span>带标题备忘</span>
        </label>
        <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={!!editingLoreEntry.constant}
            onChange={(e) =>
              setEditingLoreEntry({
                ...editingLoreEntry,
                constant: e.target.checked,
              })
            }
            className="accent-primary"
          />
          <span>常驻</span>
        </label>
        <label className="flex items-center gap-1 text-[10px] text-rose-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={!!editingLoreEntry.disabled}
            onChange={(e) =>
              setEditingLoreEntry({
                ...editingLoreEntry,
                disabled: e.target.checked,
              })
            }
            className="accent-primary"
          />
          <span className="font-semibold">禁用本词</span>
        </label>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
        <div>
          <label className="block text-muted-foreground mb-0.5">
            位置 (Position)
          </label>
          <select
            value={editingLoreEntry.position || "after_char_def"}
            onChange={(e) =>
              setEditingLoreEntry({
                ...editingLoreEntry,
                position: e.target.value as LorebookEntry["position"],
              })
            }
            className="w-full bg-input border border-border rounded p-1 text-foreground"
          >
            <option value="after_char_def">📌角色定义后</option>
            <option value="before_char_def">📌角色定义前</option>
            <option value="top">📌页面顶部</option>
            <option value="before_last_mes">💬最新消息上</option>
            <option value="in_chat">💬历史回溯中(按深度)</option>
          </select>
        </div>
        <div>
          <label className="block text-muted-foreground mb-0.5">
            深度 (Depth)
          </label>
          <input
            type="number"
            value={
              editingLoreEntry.depth !== undefined
                ? editingLoreEntry.depth
                : 4
            }
            onChange={(e) =>
              setEditingLoreEntry({
                ...editingLoreEntry,
                depth: Number(e.target.value),
              })
            }
            className="w-full bg-input border border-border rounded p-1 text-foreground font-semibold"
          />
        </div>
        <div>
          <label className="block text-muted-foreground mb-0.5">
            权重 (Order)
          </label>
          <input
            type="number"
            value={
              editingLoreEntry.order !== undefined
                ? editingLoreEntry.order
                : 100
            }
            onChange={(e) =>
              setEditingLoreEntry({
                ...editingLoreEntry,
                order: Number(e.target.value),
              })
            }
            className="w-full bg-input border border-border rounded p-1 text-foreground font-semibold"
          />
        </div>
        <div>
          <label className="block text-muted-foreground mb-0.5">
            概率 (%)
          </label>
          <input
            type="number"
            value={
              editingLoreEntry.probability !== undefined
                ? editingLoreEntry.probability
                : 100
            }
            onChange={(e) =>
              setEditingLoreEntry({
                ...editingLoreEntry,
                probability: Number(e.target.value),
              })
            }
            className="w-full bg-input border border-border rounded p-1 text-foreground font-semibold"
          />
        </div>
      </div>

      <div className="flex justify-end gap-1.5 pt-1 border-t border-border/30">
        <button
          onClick={() => setEditingLoreEntry(null)}
          type="button"
          className="bg-muted px-3 py-1 text-muted-foreground hover:text-foreground rounded text-[11px] font-semibold transition"
        >
          取消
        </button>
        <button
          onClick={handleSaveLoreEntry}
          disabled={!editingLoreEntry.content?.trim()}
          type="button"
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-3.5 py-1 rounded text-[11px] transition shadow-sm"
        >
          保存此专属词
        </button>
      </div>
    </div>
  );
}
