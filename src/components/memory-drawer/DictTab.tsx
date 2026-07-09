import { useState, useEffect } from "react";
import { ChatSession } from "../../types";
import { globalKernel } from "../../kernel/Kernel";
import { IMemoryService } from "../../kernel/types";
import {
  RefreshCw,
  BookOpen,
  Edit3,
  Check,
  Info
} from "lucide-react";

export interface DictTabProps {
  activeSession: ChatSession;
}

/**
 * 微内核插件式架构：记忆词典读取与更新统一走 MemoryService.getStorage()。
 * 遵循 AGENTS.md 准则一与准则八，业务层不再直接触碰 localDB。
 */
function getMemoryStorage() {
  return globalKernel.getService<IMemoryService>("memory").getStorage();
}

function DictTab({ activeSession }: DictTabProps) {
  // 记忆词典专属 state
  const [dictEntries, setDictEntries] = useState<any[]>([]);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editAliasesText, setEditAliasesText] = useState("");
  const [isLoadingDict, setIsLoadingDict] = useState(false);
  // 详情展开状态 (记录展开的 Entry.id)
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);

  // 当 Tab 切换到"词典"或抽屉打开时，重新加载实体词典数据
  // 注：父组件仅在 activeTab === 'dict' 时挂载本组件，等价于 isOpen && activeTab === 'dict'
  const loadDict = async () => {
    setIsLoadingDict(true);
    try {
      const entries = await getMemoryStorage().getDictBySession(activeSession.id);
      // 按出现热度 (count) 降序排序，突出高频实体
      setDictEntries(entries.sort((a, b) => b.count - a.count));
    } catch (err) {
      console.error("Failed to load memory dict:", err);
    } finally {
      setIsLoadingDict(false);
    }
  };

  useEffect(() => {
    loadDict();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession.id]);

  // 词典别名保存
  const handleSaveAliases = async (entityName: string, entry: any) => {
    const aliases = editAliasesText
      .split(/[,，\s]+/)
      .map(s => s.trim())
      .filter(Boolean);
    try {
      // 适配 MemoryService.getStorage().upsertDictEntry 签名 (sessionId, entity, patch)
      await getMemoryStorage().upsertDictEntry(
        activeSession.id,
        entityName,
        {
          type: entry.type || 'concept',
          firstSeenMsgId: entry.firstSeenMsgId || "",
          firstSeenTurn: entry.firstSeenTurn || 0,
          aliases,
          count: entry.count || 1,
        }
      );
      setEditingEntryId(null);
      await loadDict();
    } catch (e) {
      console.error("Failed to save aliases:", e);
    }
  };

  // 获取实体类型的 Emoji 前缀
  const getEntityTypeIcon = (type: string) => {
    switch (type) {
      case 'character': return '👤';
      case 'location': return '📍';
      case 'item': return '🎒';
      case 'organization': return '🛡️';
      default: return '💡';
    }
  };

  const getEntityTypeLabel = (type: string) => {
    switch (type) {
      case 'character': return '人物';
      case 'location': return '地点';
      case 'item': return '物品';
      case 'organization': return '组织';
      default: return '概念';
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-[11px] font-medium bg-muted/40 text-muted-foreground border border-border/40 rounded-lg p-2.5 leading-relaxed">
        💡 这里是 AI 在对话中**自动学习并提取**的记忆关键词（人物、地点、物品等）。系统会自动匹配这些词及别名，在对话时检索关联的历史消息，从而精准唤醒 AI 的历史记忆。
      </div>

      {isLoadingDict ? (
        <div className="py-12 text-center text-xs text-muted-foreground font-medium flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" /> 加载记忆词典中...
        </div>
      ) : dictEntries.length === 0 ? (
        <div className="border border-dashed border-border/80 rounded-xl p-12 text-center text-muted-foreground flex flex-col items-center justify-center gap-2">
          <BookOpen className="w-8 h-8 opacity-30" />
          <span className="text-xs font-bold">词典空空如也</span>
          <p className="text-[10px] max-w-xs text-muted-foreground mt-1">随着您和角色的不断对话，AI 会自动从上下文抽取实体概念积累词典。</p>
        </div>
      ) : (
        <div className="space-y-3">
          {dictEntries.map(entry => {
            const isEditing = editingEntryId === entry.id;
            return (
              <div key={entry.id} className="border border-border/50 bg-card/40 rounded-xl p-3 flex flex-col gap-2.5 transition hover:border-border/80">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-bold text-foreground">
                        {getEntityTypeIcon(entry.type)} {entry.entity}
                      </span>
                      <span className="text-[9px] font-mono font-bold bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                        提及 {entry.count} 次
                      </span>
                      <span className="text-[9px] font-medium border border-border/50 text-muted-foreground px-1.5 py-0.5 rounded bg-muted/30">
                        {getEntityTypeLabel(entry.type)}
                      </span>
                    </div>

                    {/* Display Aliases */}
                    {!isEditing && (
                      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                        <span className="text-[10px] text-muted-foreground shrink-0">别名:</span>
                        {Array.isArray(entry.aliases) && entry.aliases.length > 0 ? (
                          entry.aliases.map((a: string, idx: number) => (
                            <span key={idx} className="text-[9px] font-semibold bg-primary/5 border border-primary/10 text-primary px-1.5 py-0.5 rounded">
                              {a}
                            </span>
                          ))
                        ) : (
                          <span className="text-[9px] text-muted-foreground/40 italic">暂无别名</span>
                        )}
                      </div>
                    )}
                  </div>

                  {!isEditing && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => {
                          setExpandedEntryId(expandedEntryId === entry.id ? null : entry.id);
                        }}
                        className={`p-1 rounded transition ${expandedEntryId === entry.id ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:bg-muted'}`}
                        title="查看详情"
                      >
                        <Info className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          setEditingEntryId(entry.id);
                          setEditAliasesText((entry.aliases || []).join(", "));
                        }}
                        className="p-1 rounded text-muted-foreground hover:bg-muted transition"
                        title="编辑别名"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* 详情展示区域 */}
                {expandedEntryId === entry.id && (
                  <div className="text-[10px] space-y-1.5 bg-muted/20 border border-border/30 rounded-xl p-2.5 font-medium text-muted-foreground leading-relaxed animate-in fade-in slide-in-from-top-1 duration-150">
                    <div className="flex justify-between">
                      <span>首次出现轮次:</span>
                      <span className="font-semibold text-foreground">第 {entry.firstSeenTurn + 1} 轮对话</span>
                    </div>
                    <div className="flex justify-between">
                      <span>创建时间:</span>
                      <span className="font-semibold text-foreground">{new Date(entry.createdAt).toLocaleString("zh-CN")}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>最近更新时间:</span>
                      <span className="font-semibold text-foreground">{new Date(entry.updatedAt).toLocaleString("zh-CN")}</span>
                    </div>
                  </div>
                )}

                {/* Edit Aliases Expand Input */}
                {isEditing && (
                  <div className="flex items-center gap-2 border-t border-border/30 pt-2 bg-muted/5 p-1 rounded-lg">
                    <input
                      value={editAliasesText}
                      onChange={(e) => setEditAliasesText(e.target.value)}
                      placeholder="用逗号或空格分隔别名，如: 张老板, 酒馆老板"
                      className="flex-1 text-[11px] bg-background border border-border px-2 py-1 rounded focus:outline-none focus:ring-1 focus:ring-primary/20"
                    />
                    <button
                      onClick={() => handleSaveAliases(entry.entity, entry)}
                      className="px-2 py-1 text-[10px] font-bold bg-primary text-primary-foreground rounded hover:bg-primary/95 flex items-center gap-0.5 shadow-sm"
                    >
                      <Check className="w-3 h-3" /> 保存
                    </button>
                    <button
                      onClick={() => setEditingEntryId(null)}
                      className="px-2 py-1 text-[10px] font-bold border border-border rounded text-muted-foreground hover:bg-muted"
                    >
                      取消
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default DictTab;
