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
  EyeOff
} from "lucide-react";

interface MemoryTableDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeSession: ChatSession;
  saveSession: (session: ChatSession) => Promise<void>;
  charName: string;
}

export const MemoryTableDrawer: React.FC<MemoryTableDrawerProps> = ({
  isOpen,
  onClose,
  activeSession,
  saveSession,
  charName
}) => {
  const [activeTabId, setActiveTabId] = useState<string>("");
  const [editingCell, setEditingCell] = useState<{ sheetId: string; rowIndex: number; colIndex: number } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showConfig, setShowConfig] = useState(false);

  const sheets = activeSession.tableMemory || [];

  // Set default active tab if empty
  React.useEffect(() => {
    if (sheets.length > 0 && !activeTabId) {
      setActiveTabId(sheets[0].id);
    }
  }, [sheets, activeTabId]);

  if (!isOpen) return null;

  const activeSheet = sheets.find(s => s.id === activeTabId) || sheets[0];

  // Helper to persist sheets updates
  const updateSheets = async (nextSheets: TableMemorySheet[]) => {
    const nextSession = {
      ...activeSession,
      tableMemory: nextSheets
    };
    await saveSession(nextSession);
  };

  // Add row
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

  // Delete row
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

  // Cell Edit Start
  const startEditing = (sheetId: string, rowIndex: number, colIndex: number, currentVal: string) => {
    setEditingCell({ sheetId, rowIndex, colIndex });
    setEditValue(currentVal);
  };

  // Cell Edit Save
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

  // Key Down Handler in inputs
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      saveEditing();
    } else if (e.key === "Escape") {
      setEditingCell(null);
    }
  };

  // Toggle Sheet enabled in LLM prompt context
  const toggleSheetEnabled = async (sheetId: string) => {
    const nextSheets = sheets.map(s => {
      if (s.id === sheetId) {
        return { ...s, enable: !s.enable };
      }
      return s;
    });
    await updateSheets(nextSheets);
  };

  // Initialize/Reset Default Table
  const handleResetToDefault = async () => {
    const defaultSheets: TableMemorySheet[] = [
      {
        id: "sheet_status_and_relation",
        name: "状态与关系",
        columns: ["角色", "好感度", "亲密度", "当前状态描述"],
        rows: [
          [charName || "NPC", "50", "相识", "初次结识，关系尚显生疏"]
        ],
        enable: true,
        description: "用于记录当前角色和你之间的当前好感状态和亲密关系定位"
      }
    ];
    await updateSheets(defaultSheets);
    if (defaultSheets.length > 0) {
      setActiveTabId(defaultSheets[0].id);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-[2px] transition-all duration-300">
      <div className="w-full max-w-lg bg-background/95 border-t border-border/80 rounded-t-2xl shadow-2xl overflow-hidden flex flex-col h-[75vh] backdrop-blur-xl env-bottom">
        
        {/* Header Section */}
        <div className="px-4 py-3 border-b border-border/50 flex justify-between items-center bg-muted/30">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold bg-primary/10 text-primary px-2.5 py-1 rounded-full flex items-center gap-1 font-sans">
              🌟 记忆档案柜
            </span>
            <span className="text-xs text-muted-foreground">结构化属性与关系</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button 
              onClick={() => setShowConfig(!showConfig)}
              className={`p-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1 transition ${showConfig ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-muted border-border hover:bg-muted/80 text-muted-foreground'}`}
            >
              ⚙️ 管理
            </button>
            <button 
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-muted border border-border/40 text-muted-foreground transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Selector */}
        {sheets.length > 0 && !showConfig && (
          <div className="flex px-4 py-2 bg-muted/10 border-b border-border/40 gap-1.5 overflow-x-auto scrollbar-none">
            {sheets.map(s => (
              <button
                key={s.id}
                onClick={() => {
                  setActiveTabId(s.id);
                  setEditingCell(null);
                }}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg shrink-0 border transition-all ${
                  activeSheet?.id === s.id
                    ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/20"
                    : "bg-card hover:bg-muted border-border/75 text-muted-foreground"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}

        {/* Inner Content Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {showConfig ? (
            /* CONFIG MODE (MANAGEMENT) */
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold font-mono text-muted-foreground">表格管理面</span>
                <button
                  onClick={handleResetToDefault}
                  className="text-xs font-bold text-destructive bg-destructive/10 border border-destructive/20 hover:bg-destructive/20 px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition"
                >
                  <RefreshCw className="w-3 h-3" /> 重置为默认表格
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
                    <div key={s.id} className="border border-border/80 bg-card rounded-xl p-3 flex items-center justify-between gap-3 shadow-sm">
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
                              ? "bg-emerald/10 border-emerald/20 text-emerald"
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
                  <div className="border border-border/60 rounded-xl overflow-hidden shadow-sm bg-card">
                    <div className="overflow-x-auto scrollbar-thin">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-muted/50 border-b border-border/60">
                            {activeSheet.columns.map((col, idx) => (
                              <th 
                                key={idx} 
                                className="px-3 py-2.5 font-bold text-muted-foreground font-sans tracking-wide shrink-0 whitespace-nowrap"
                              >
                                {col}
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
                                {row.map((val, cIdx) => {
                                  const isEditing = editingCell?.sheetId === activeSheet.id && editingCell?.rowIndex === rIdx && editingCell?.colIndex === cIdx;
                                  return (
                                    <td 
                                      key={cIdx} 
                                      className="px-3 py-2 text-foreground font-medium relative align-middle group min-w-[80px]"
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
                                              e.preventDefault(); // Prevent blur trigger
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
                                          className="cursor-pointer hover:bg-muted/30 px-1 py-0.5 rounded transition min-h-[1.5rem] flex items-center justify-between"
                                        >
                                          <span className="truncate max-w-[200px]" title={val}>{val || <span className="text-muted-foreground/30 font-light italic">空</span>}</span>
                                          <Edit3 className="w-3 h-3 opacity-0 group-hover:opacity-40 text-muted-foreground shrink-0 ml-1 transition-opacity" />
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
        </div>
      </div>
    </div>
  );
};
