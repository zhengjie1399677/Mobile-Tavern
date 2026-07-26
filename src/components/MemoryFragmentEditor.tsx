import React, { useState } from "react";
import { getDB } from "../utils/localDB";
import { useTranslation } from "../contexts/LanguageContext";
import { X, Trash2, Check, Plus, Tag } from "lucide-react";
import type { MemoryFragment } from "./BranchUniverseDiagram";

interface MemoryFragmentEditorProps {
  fragment: MemoryFragment;
  onClose: () => void;
  onSave: (updated: MemoryFragment) => void;
  onDelete: (id: string) => void;
}

export default function MemoryFragmentEditor({
  fragment,
  onClose,
  onSave,
  onDelete,
}: MemoryFragmentEditorProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState(fragment.content);
  const [tags, setTags] = useState<string[]>(fragment.tags || []);
  const [newTag, setNewTag] = useState("");

  // 1. 保存更改到 IndexedDB
  const handleSave = async () => {
    if (!content.trim()) return;
    try {
      const db = await getDB();
      const tx = db.transaction("memory_fragments", "readwrite");
      const store = tx.objectStore("memory_fragments");
      
      const updated: MemoryFragment = {
        ...fragment,
        content: content.trim(),
        tags,
      };

      await new Promise<void>((resolve, reject) => {
        const req = store.put(updated);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });

      onSave(updated);
    } catch (err) {
      console.error("[MemoryFragmentEditor] Save failed", err);
    }
  };

  // 2. 从 IndexedDB 物理删除该碎片
  const handleDelete = async () => {
    try {
      const db = await getDB();
      const tx = db.transaction("memory_fragments", "readwrite");
      const store = tx.objectStore("memory_fragments");

      await new Promise<void>((resolve, reject) => {
        const req = store.delete(fragment.id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });

      onDelete(fragment.id);
    } catch (err) {
      console.error("[MemoryFragmentEditor] Delete failed", err);
    }
  };

  // 3. 标签交互操作
  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    const tag = newTag.trim();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
    }
    setNewTag("");
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[1000] flex items-center justify-center p-4 transition-all duration-200">
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl max-w-md w-full p-5 shadow-2xl text-foreground flex flex-col gap-4 animate-scale-up">
        
        {/* 顶部标题与关闭 */}
        <div className="flex justify-between items-center pb-2 border-b border-zinc-800">
          <p className="font-bold text-sm text-zinc-200 flex items-center gap-2">
            <Tag className="w-4 h-4 text-primary" /> {t("memory.audit_title") || "长期记忆审计与编辑"}
          </p>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1 hover:bg-zinc-800/80 rounded-md transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 记忆文本编辑域 */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-zinc-400 font-semibold">
            {t("memory.content_label") || "提炼出的事件事实"}
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full min-h-[100px] p-3 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-300 focus:outline-none focus:border-primary/80 transition resize-none leading-relaxed font-sans"
            placeholder="输入提炼的事实内容..."
          />
        </div>

        {/* 标签管理层 */}
        <div className="flex flex-col gap-2">
          <label className="text-xs text-zinc-400 font-semibold">
            {t("memory.tags_label") || "关联实体与特征标签"}
          </label>
          
          {/* 已选标签列表 */}
          <div className="flex flex-wrap gap-1.5 max-h-[70px] overflow-y-auto pr-1">
            {tags.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] bg-primary/10 border border-primary/20 text-primary-foreground/90 rounded-full font-sans"
              >
                {t}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(t)}
                  className="text-primary-foreground/50 hover:text-primary-foreground font-bold"
                >
                  &times;
                </button>
              </span>
            ))}
            {tags.length === 0 && (
              <span className="text-[10px] text-zinc-500 italic">暂无关联标签</span>
            )}
          </div>

          {/* 新建标签小表单 */}
          <form onSubmit={handleAddTag} className="flex gap-2">
            <input
              type="text"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="新增标签 (回车确定)"
              className="flex-1 px-3 py-1.5 text-xs bg-zinc-950 border border-zinc-800 rounded-md text-zinc-300 focus:outline-none focus:border-primary/50 transition font-sans"
            />
            <button
              type="submit"
              className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-md transition font-semibold"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>

        {/* 底部控制按钮组 */}
        <div className="flex justify-between items-center pt-3 border-t border-zinc-800 gap-3 shrink-0">
          <button
            onClick={handleDelete}
            className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs bg-red-950/40 border border-red-900/60 hover:bg-red-950/80 text-red-400 hover:text-red-300 rounded-lg transition-all"
            title="删除记忆碎片"
          >
            <Trash2 className="w-3.5 h-3.5" /> {t("common.delete") || "物理删除"}
          </button>
          
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-2 text-xs bg-zinc-800/80 hover:bg-zinc-850 border border-zinc-750 text-zinc-300 hover:text-white rounded-lg transition"
            >
              {t("common.cancel") || "取消"}
            </button>
            <button
              onClick={handleSave}
              className="flex items-center justify-center gap-1.5 px-4 py-2 text-xs bg-primary text-primary-foreground font-semibold rounded-lg hover:opacity-90 active:scale-95 transition"
            >
              <Check className="w-3.5 h-3.5" /> {t("common.save") || "保存修改"}
            </button>
          </div>
        </div>

      </div>

      <style>{`
        .animate-scale-up {
          animation: scale-up-anim 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @keyframes scale-up-anim {
          from {
            transform: scale(0.92);
            opacity: 0;
          }
          to {
            transform: scale(1);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
