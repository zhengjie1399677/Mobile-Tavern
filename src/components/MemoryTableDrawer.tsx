import React, { useState } from "react";
import { ChatSession, TableMemorySheet } from "../types";
import { 
  X, 
  Plus, 
  Trash2, 
  Check, 
  HelpCircle, 
  Edit3, 
  RefreshCw,
  Eye,
  EyeOff,
  Pin,
  VolumeX,
  BookOpen,
  BrainCircuit,
  Tag
} from "lucide-react";
import { getDictBySession, upsertDictEntry } from "../utils/localDB";

interface MemoryTableDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeSession: ChatSession;
  saveSession: (session: ChatSession) => Promise<void>;
  charName: string;
  enableTableMemory: boolean;
}

export const MemoryTableDrawer: React.FC<MemoryTableDrawerProps> = ({
  isOpen,
  onClose,
  activeSession,
  saveSession,
  charName,
  enableTableMemory
}) => {
  // 大 Tab 面板：'table' | 'dict' | 'recall'
  const [activeTab, setActiveTab] = useState<'table' | 'dict' | 'recall'>(
    enableTableMemory ? 'table' : 'recall'
  );

  // 当抽屉打开时，根据当前表格配置动态重置默认 Tab
  React.useEffect(() => {
    if (isOpen) {
      setActiveTab(enableTableMemory ? 'table' : 'recall');
    }
  }, [isOpen, enableTableMemory]);
  const [activeTableTabId, setActiveTableTabId] = useState<string>("");
  const [editingCell, setEditingCell] = useState<{ sheetId: string; rowIndex: number; colIndex: number } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showConfig, setShowConfig] = useState(false);

  // 心智词典专属 state
  const [dictEntries, setDictEntries] = useState<any[]>([]);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editAliasesText, setEditAliasesText] = useState("");
  const [isLoadingDict, setIsLoadingDict] = useState(false);

  // 防御性过滤状态表
  const rawSheets = activeSession.tableMemory || [];
  const sheets: TableMemorySheet[] = Array.isArray(rawSheets)
    ? rawSheets.filter((s): s is TableMemorySheet =>
        !!s && Array.isArray(s.columns) && Array.isArray(s.rows)
      )
    : [];

  // 默认选中第一个状态表 Tab
  React.useEffect(() => {
    if (sheets.length > 0 && !activeTableTabId) {
      setActiveTableTabId(sheets[0].id);
    }
  }, [sheets, activeTableTabId]);

  // 当 Tab 切换到“词典”或抽屉打开时，重新加载实体词典数据
  const loadDict = async () => {
    setIsLoadingDict(true);
    try {
      const entries = await getDictBySession(activeSession.id);
      // 按出现热度 (count) 降序排序，突出高频实体
      setDictEntries(entries.sort((a, b) => b.count - a.count));
    } catch (err) {
      console.error("Failed to load memory dict:", err);
    } finally {
      setIsLoadingDict(false);
    }
  };

  React.useEffect(() => {
    if (isOpen && activeTab === 'dict') {
      loadDict();
    }
  }, [isOpen, activeTab, activeSession.id]);

  if (!isOpen) return null;

  const activeSheet = sheets.find(s => s.id === activeTableTabId) || sheets[0];

  // 持久化状态表
  const updateSheets = async (nextSheets: TableMemorySheet[]) => {
    const nextSession = {
      ...activeSession,
      tableMemory: nextSheets
    };
    await saveSession(nextSession);
  };

  // 添加行
  const handleAddRow = async (sheetId: string) => {
    const nextSheets = sheets.map(s => {
      if (s.id === sheetId) {
        return {
          ...s,
          rows: [...s.rows, s.columns.map(() => "")]
        };
      }
      return s;
    });
    await updateSheets(nextSheets);
  };

  // 删除行
  const handleDeleteRow = async (sheetId: string, rowIndex: number) => {
    const nextSheets = sheets.map(s => {
      if (s.id === sheetId) {
        return {
          ...s,
          rows: s.rows.filter((_, idx) => idx !== rowIndex)
        };
      }
      return s;
    });
    await updateSheets(nextSheets);
  };

  // 单元格编辑开启
  const startEditing = (sheetId: string, rowIndex: number, colIndex: number, currentVal: string) => {
    setEditingCell({ sheetId, rowIndex, colIndex });
    setEditValue(currentVal);
  };

  // 单元格编辑保存
  const saveEditing = async () => {
    if (!editingCell) return;
    const { sheetId, rowIndex, colIndex } = editingCell;

    const nextSheets = sheets.map(s => {
      if (s.id === sheetId) {
        const nextRows = s.rows.map((row, rIdx) => {
          if (rIdx === rowIndex) {
            const nextRow = [...row];
            nextRow[colIndex] = editValue;
            return nextRow;
          }
          return row;
        });
        return {
          ...s,
          rows: nextRows
        };
      }
      return s;
    });

    await updateSheets(nextSheets);
    setEditingCell(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      saveEditing();
    } else if (e.key === "Escape") {
      setEditingCell(null);
    }
  };

  // 停用/启用表格在 Prompt 里的注入
  const toggleSheetEnabled = async (sheetId: string) => {
    const nextSheets = sheets.map(s => {
      if (s.id === sheetId) {
        return { ...s, enable: !s.enable };
      }
      return s;
    });
    await updateSheets(nextSheets);
  };

  // 重置默认状态表
  const handleResetToDefault = async () => {
    const defaultSheets: TableMemorySheet[] = [
      {
        id: "sheet_relation",
        name: "关系",
        columns: ["角色", "好感度", "亲密度", "当前状态描述"],
        rows: [[charName || "NPC", "50", "相识", "初次结识，关系尚显生疏"]],
        enable: true,
        description: "记录角色与玩家（你）之间的好感状态和亲密关系定位",
      },
      {
        id: "sheet_inventory",
        name: "物品",
        columns: ["物品名", "数量", "获得方式", "备注"],
        rows: [],
        enable: true,
        description: "记录玩家持有的关键物品及其来源",
      },
      {
        id: "sheet_location",
        name: "位置",
        columns: ["地点", "区域", "到达方式", "描述"],
        rows: [],
        enable: true,
        description: "记录已探索的地点和当前所在位置",
      },
      {
        id: "sheet_quest",
        name: "任务",
        columns: ["任务名", "状态", "触发条件", "备注"],
        rows: [],
        enable: true,
        description: "记录进行中、已完成、已失败的任务",
      },
    ];
    await updateSheets(defaultSheets);
    if (defaultSheets.length > 0) {
      setActiveTableTabId(defaultSheets[0].id);
    }
  };

  // 词典别名保存
  const handleSaveAliases = async (entityName: string, entry: any) => {
    const aliases = editAliasesText
      .split(/[,，\s]+/)
      .map(s => s.trim())
      .filter(Boolean);
    try {
      await upsertDictEntry({
        id: entry.id,
        sessionId: activeSession.id,
        entity: entityName,
        type: entry.type || 'concept',
        firstSeenMsgId: entry.firstSeenMsgId || "",
        firstSeenTurn: entry.firstSeenTurn || 0,
        aliases,
        count: entry.count || 1,
        createdAt: entry.createdAt || Date.now(),
        updatedAt: Date.now()
      });
      setEditingEntryId(null);
      await loadDict();
    } catch (e) {
      console.error("Failed to save aliases:", e);
    }
  };

  // Pin (钉子) 逻辑交互
  const handleTogglePin = async (messageId: string) => {
    const pinned = activeSession.pinnedMessageIds || [];
    const muted = activeSession.mutedMessageIds || [];
    let nextPinned = [...pinned];
    let nextMuted = [...muted];

    if (pinned.includes(messageId)) {
      nextPinned = nextPinned.filter(id => id !== messageId);
    } else {
      nextPinned.push(messageId);
      nextMuted = nextMuted.filter(id => id !== messageId);
    }

    const nextSession = {
      ...activeSession,
      pinnedMessageIds: nextPinned,
      mutedMessageIds: nextMuted
    };
    await saveSession(nextSession);
  };

  // Mute (小黑屋) 逻辑交互
  const handleToggleMute = async (messageId: string) => {
    const pinned = activeSession.pinnedMessageIds || [];
    const muted = activeSession.mutedMessageIds || [];
    let nextPinned = [...pinned];
    let nextMuted = [...muted];

    if (muted.includes(messageId)) {
      nextMuted = nextMuted.filter(id => id !== messageId);
    } else {
      nextMuted.push(messageId);
      nextPinned = nextPinned.filter(id => id !== messageId);
    }

    const nextSession = {
      ...activeSession,
      pinnedMessageIds: nextPinned,
      mutedMessageIds: nextMuted
    };
    await saveSession(nextSession);
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

  const lastRecalled = (activeSession as any).lastRecalledMemories || [];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-[2px] transition-all duration-300">
      <div className="w-full max-w-lg bg-background/85 border-t border-border/80 rounded-t-2xl shadow-2xl overflow-hidden flex flex-col h-[75vh] backdrop-blur-xl env-bottom">
        
        {/* Header Section */}
        <div className="px-4 py-3 border-b border-border/50 flex justify-between items-center bg-muted/30">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold bg-primary/10 text-primary px-2.5 py-1 rounded-full flex items-center gap-1.5 font-sans">
              <BrainCircuit className="w-3.5 h-3.5" />
              多维认知记忆中心
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {activeTab === 'table' && (
              <button 
                onClick={() => setShowConfig(!showConfig)}
                className={`p-1.5 rounded-lg border text-[11px] font-semibold flex items-center gap-1 transition ${showConfig ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-muted border-border hover:bg-muted/80 text-muted-foreground'}`}
              >
                ⚙️ 管理
              </button>
            )}
            <button 
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-muted border border-border/40 text-muted-foreground transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab 栏切换器 */}
        <div className="flex border-b border-border/30 bg-muted/10 px-4 py-2 gap-2 text-xs font-semibold overflow-x-auto scrollbar-none shrink-0">
          {enableTableMemory && (
            <button
              onClick={() => { setActiveTab('table'); setShowConfig(false); }}
              className={`px-3 py-1.5 rounded-lg border transition-all ${
                activeTab === 'table' ? 'bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/15' : 'bg-transparent border-transparent text-muted-foreground hover:bg-muted/50'
              }`}
            >
              状态沙盒
            </button>
          )}
          <button
            onClick={() => setActiveTab('dict')}
            className={`px-3 py-1.5 rounded-lg border transition-all ${
              activeTab === 'dict' ? 'bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/15' : 'bg-transparent border-transparent text-muted-foreground hover:bg-muted/50'
            }`}
          >
            心智词典
          </button>
          <button
            onClick={() => setActiveTab('recall')}
            className={`px-3 py-1.5 rounded-lg border transition-all ${
              activeTab === 'recall' ? 'bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/15' : 'bg-transparent border-transparent text-muted-foreground hover:bg-muted/50'
            }`}
          >
            记忆唤醒舱
          </button>
        </div>

        {/* Inner Content Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          
          {/* TAB 1: 📊 状态沙盒 */}
          {activeTab === 'table' && (
            <>
              {/* Tab Selector inside Table Section */}
              {sheets.length > 0 && !showConfig && (
                <div className="flex pb-2 gap-1.5 overflow-x-auto scrollbar-none shrink-0">
                  {sheets.map(s => (
                    <button
                      key={s.id}
                      onClick={() => {
                        setActiveTableTabId(s.id);
                        setEditingCell(null);
                      }}
                      className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border transition-all ${
                        activeTableTabId === s.id
                          ? "bg-primary/10 border-primary/25 text-primary"
                          : "bg-card border-border/75 text-muted-foreground hover:bg-muted/50"
                      }`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}

              {showConfig ? (
                /* CONFIG MODE (MANAGEMENT) */
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold font-mono text-muted-foreground">状态表格管理面板</span>
                    <button
                      onClick={handleResetToDefault}
                      className="text-xs font-bold text-destructive bg-destructive/10 border border-destructive/20 hover:bg-destructive/20 px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition"
                    >
                      <RefreshCw className="w-3 h-3" /> 重置默认表
                    </button>
                  </div>

                  {sheets.length === 0 ? (
                    <div className="border border-dashed border-border/80 rounded-xl p-8 text-center text-muted-foreground flex flex-col items-center justify-center gap-2">
                      <HelpCircle className="w-8 h-8 opacity-40" />
                      <span className="text-xs font-bold">暂无结构化表格</span>
                      <button
                        onClick={handleResetToDefault}
                        className="mt-2 text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/95 px-3 py-1.5 rounded-lg transition"
                      >
                        初始化默认表格
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {sheets.map(s => (
                        <div key={s.id} className="border border-border/80 bg-card/60 rounded-xl p-3 flex items-center justify-between gap-3 shadow-sm">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-foreground truncate">{s.name}</span>
                              <span className="text-[9px] font-mono px-1 py-0.5 border border-border/50 rounded bg-muted text-muted-foreground">
                                {s.columns.length}列 · {s.rows.length}行
                              </span>
                            </div>
                            {s.description && (
                              <p className="text-[10px] text-muted-foreground truncate mt-1">{s.description}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={() => toggleSheetEnabled(s.id)}
                              className={`p-1.5 rounded-lg border transition ${
                                s.enable
                                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
                                  : "bg-muted border-border text-muted-foreground opacity-60"
                              }`}
                              title={s.enable ? "注入 prompt" : "已停用注入"}
                            >
                              {s.enable ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* ACTIVE TABLE SHEET RENDER */
                <>
                  {!activeSheet ? (
                    <div className="border border-dashed border-border/80 rounded-xl p-8 text-center text-muted-foreground flex flex-col items-center justify-center gap-2">
                      <HelpCircle className="w-8 h-8 opacity-40" />
                      <span className="text-xs font-bold">请先初始化表格记忆功能</span>
                      <button
                        onClick={handleResetToDefault}
                        className="mt-2 text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/95 px-3 py-1.5 rounded-lg transition"
                      >
                        一键初始化
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {activeSheet.description && (
                        <div className="text-[11px] font-medium bg-muted/40 text-muted-foreground border border-border/40 rounded-lg p-2.5 leading-relaxed">
                          💡 {activeSheet.description.replace("{{user}}", "你")}
                        </div>
                      )}

                      {/* HTML Grid Table */}
                      <div className="border border-border/60 rounded-xl overflow-hidden shadow-sm bg-card/50">
                        <div className="overflow-x-auto scrollbar-thin">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="bg-muted/50 border-b border-border/60">
                                {activeSheet.columns.map((col, idx) => (
                                  <th 
                                    key={idx} 
                                    className="px-3 py-2.5 font-bold text-muted-foreground font-sans tracking-wide shrink-0 min-w-[90px] max-w-[160px]"
                                  >
                                    <span className="block truncate max-w-[140px]" title={col}>
                                      {col}
                                    </span>
                                  </th>
                                ))}
                                <th className="px-3 py-2.5 font-bold text-muted-foreground w-10 text-center">操作</th>
                              </tr>
                            </thead>
                            <tbody>
                              {activeSheet.rows.length === 0 ? (
                                <tr>
                                  <td colSpan={activeSheet.columns.length + 1} className="px-3 py-6 text-center text-muted-foreground opacity-60">
                                    暂无记录数据，点击下方添加按钮新增一行
                                  </td>
                                </tr>
                              ) : (
                                activeSheet.rows.map((row, rIdx) => (
                                  <tr key={rIdx} className="border-b border-border/40 hover:bg-muted/10 last:border-0">
                                    {(Array.isArray(row) ? row : []).map((val, cIdx) => {
                                      const isEditing = editingCell?.sheetId === activeSheet.id && editingCell?.rowIndex === rIdx && editingCell?.colIndex === cIdx;
                                      return (
                                        <td 
                                          key={cIdx} 
                                          className="px-3 py-2 text-foreground font-medium relative align-middle group min-w-[90px] max-w-[160px]"
                                        >
                                          {isEditing ? (
                                            <div className="flex items-center gap-1">
                                              <input
                                                value={editValue}
                                                onChange={(e) => setEditValue(e.target.value)}
                                                onBlur={saveEditing}
                                                onKeyDown={handleKeyDown}
                                                autoFocus
                                                className="w-full text-xs bg-background border border-primary px-1.5 py-0.5 rounded shadow-sm focus:outline-none focus:ring-1 focus:ring-primary/20"
                                              />
                                              <button 
                                                onMouseDown={(e) => {
                                                  e.preventDefault();
                                                  saveEditing();
                                                }}
                                                className="p-0.5 bg-primary text-primary-foreground rounded hover:bg-primary/95 shrink-0"
                                              >
                                                <Check className="w-3 h-3" />
                                              </button>
                                            </div>
                                          ) : (
                                            <div 
                                              onClick={() => startEditing(activeSheet.id, rIdx, cIdx, val)}
                                              className="cursor-pointer hover:bg-muted/30 px-1 py-1 rounded transition min-h-[1.5rem] flex items-start justify-between gap-1"
                                            >
                                              <span className="break-all whitespace-pre-wrap text-[11px] leading-relaxed block flex-1" title={val}>{val || <span className="text-muted-foreground/30 font-light italic">空</span>}</span>
                                              <Edit3 className="w-3 h-3 opacity-30 text-muted-foreground shrink-0 mt-0.5 group-hover:opacity-60 transition-opacity" />
                                            </div>
                                          )}
                                        </td>
                                      );
                                    })}
                                    <td className="px-3 py-2 text-center align-middle">
                                      <button
                                        onClick={() => handleDeleteRow(activeSheet.id, rIdx)}
                                        className="p-1 rounded text-destructive hover:bg-destructive/10 transition shrink-0 inline-flex items-center justify-center"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex justify-end pt-1">
                        <button
                          onClick={() => handleAddRow(activeSheet.id)}
                          className="text-xs font-bold text-primary bg-primary/10 border border-primary/25 hover:bg-primary/20 px-3 py-2 rounded-xl flex items-center gap-1.5 transition shadow-sm"
                        >
                          <Plus className="w-4 h-4" /> 添加新行
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* TAB 2: 📖 心智词典 */}
          {activeTab === 'dict' && (
            <div className="space-y-4">
              <div className="text-[11px] font-medium bg-muted/40 text-muted-foreground border border-border/40 rounded-lg p-2.5 leading-relaxed">
                💡 这里是 AI 在对话中**自动学习与涌现**的认知概念。AC 自动机将利用这些概念及其别名，在输入时自动匹配查询标签，从而精准唤醒您的历史记忆。
              </div>

              {isLoadingDict ? (
                <div className="py-12 text-center text-xs text-muted-foreground font-medium flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin" /> 加载心智词典中...
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
                            <button
                              onClick={() => {
                                setEditingEntryId(entry.id);
                                setEditAliasesText((entry.aliases || []).join(", "));
                              }}
                              className="p-1 rounded text-muted-foreground hover:bg-muted transition shrink-0"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

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
          )}

          {/* TAB 3: 🧠 记忆唤醒舱 */}
          {activeTab === 'recall' && (
            <div className="space-y-4">
              <div className="text-[11px] font-medium bg-muted/40 text-muted-foreground border border-border/40 rounded-lg p-2.5 leading-relaxed">
                💡 这里是**最近一次发送消息中被 AI 成功唤醒的历史发言**。在此进行标记可以强力修正 AI 的心智细节。
              </div>

              {lastRecalled.length === 0 ? (
                <div className="border border-dashed border-border/80 rounded-xl p-12 text-center text-muted-foreground flex flex-col items-center justify-center gap-2">
                  <BrainCircuit className="w-8 h-8 opacity-30 animate-pulse" />
                  <span className="text-xs font-bold">本轮未唤醒相关记忆</span>
                  <p className="text-[10px] max-w-xs text-muted-foreground mt-1">这意味着当前的话题没有匹配上词典实体，或者数据库中尚无足够关联的历史细节。</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {lastRecalled.map((msg: any) => {
                    const isPinned = (activeSession.pinnedMessageIds || []).includes(msg.messageId);
                    const isMuted = (activeSession.mutedMessageIds || []).includes(msg.messageId);

                    return (
                      <div 
                        key={msg.messageId} 
                        className={`border rounded-xl p-3 flex flex-col gap-2 transition ${
                          isPinned 
                            ? "bg-primary/5 border-primary/45 shadow-sm" 
                            : isMuted 
                            ? "bg-muted/30 border-border/40 opacity-40" 
                            : "bg-card/40 border-border/50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 border border-border/50 bg-muted rounded text-muted-foreground">
                              轮次 {msg.turnIndex + 1}
                            </span>
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              msg.role === 'user' ? 'bg-primary/10 text-primary' : 'bg-card text-muted-foreground border border-border'
                            }`}>
                              {msg.role === 'user' ? '用户' : '角色'}
                            </span>
                          </div>
                          
                          {/* Row Actions: Pin or Mute */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={() => handleTogglePin(msg.messageId)}
                              className={`p-1 rounded border transition ${
                                isPinned 
                                  ? "bg-primary border-primary text-primary-foreground" 
                                  : "hover:bg-muted border-border/60 text-muted-foreground"
                              }`}
                              title={isPinned ? "取消 Pin 固定" : "强行 Pin 固定"}
                            >
                              <Pin className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => handleToggleMute(msg.messageId)}
                              className={`p-1 rounded border transition ${
                                isMuted 
                                  ? "bg-destructive border-destructive text-destructive-foreground" 
                                  : "hover:bg-muted border-border/60 text-muted-foreground"
                              }`}
                              title={isMuted ? "取消 Mute 屏蔽" : "强行 Mute 屏蔽"}
                            >
                              <VolumeX className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        {/* Content Preview */}
                        <p className="text-[11px] leading-relaxed text-foreground/90 whitespace-pre-wrap break-all pl-1 italic">
                          "{msg.content}"
                        </p>

                        {/* Hit Tags */}
                        {Array.isArray(msg.hitTags) && msg.hitTags.length > 0 && (
                          <div className="flex items-center gap-1 mt-1 pl-1 flex-wrap">
                            <Tag className="w-2.5 h-2.5 text-muted-foreground/60 shrink-0" />
                            <span className="text-[9px] text-muted-foreground shrink-0">命中标签:</span>
                            {msg.hitTags.map((tag: string, idx: number) => (
                              <span key={idx} className="text-[8px] font-bold bg-primary/5 border border-primary/10 text-primary px-1 py-0.2 rounded">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
