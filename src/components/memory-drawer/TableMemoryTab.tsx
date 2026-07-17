import { useState, useEffect, type KeyboardEvent } from "react";
import { ChatSession, TableMemorySheet } from "../../types";
import { useTranslation } from "../../contexts/LanguageContext";
import {
  Plus,
  Trash2,
  Check,
  HelpCircle,
  Edit3,
  RefreshCw,
  Eye,
  EyeOff,
  X,
} from "lucide-react";

export interface TableMemoryTabProps {
  activeSession: ChatSession;
  saveSession: (session: ChatSession) => Promise<void>;
  charName: string;
}

/** 新建表/编辑表时的中间态结构。id 为 "new" 表示新建，否则为正在编辑的 sheet id。 */
interface SheetDraft {
  id: string;
  name: string;
  description: string;
  columns: string[];
}

function TableMemoryTab({ activeSession, saveSession, charName }: TableMemoryTabProps) {
  const { t } = useTranslation();
  const [activeTableTabId, setActiveTableTabId] = useState<string>("");
  const [editingCell, setEditingCell] = useState<{ sheetId: string; rowIndex: number; colIndex: number } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  /** 管理面板的表结构编辑器状态：null 时不显示编辑面板，非 null 时进入编辑视图 */
  const [sheetDraft, setSheetDraft] = useState<SheetDraft | null>(null);

  // 防御性过滤状态表
  const rawSheets = activeSession.tableMemory || [];
  const sheets: TableMemorySheet[] = Array.isArray(rawSheets)
    ? rawSheets.filter((s): s is TableMemorySheet =>
      !!s && Array.isArray(s.columns) && Array.isArray(s.rows)
    )
    : [];

  // 默认选中第一个状态表 Tab
  useEffect(() => {
    if (sheets.length > 0 && !activeTableTabId) {
      setActiveTableTabId(sheets[0].id);
    }
  }, [sheets, activeTableTabId]);

  const activeSheet = sheets.find(s => s.id === activeTableTabId) || sheets[0];

  // 持久化状态表
  const updateSheets = async (nextSheets: TableMemorySheet[]) => {
    const nextSession = {
      ...activeSession,
      tableMemory: nextSheets
    };
    await saveSession(nextSession);
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 行级操作
  // ──────────────────────────────────────────────────────────────────────────

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

  // 删除行（带二次确认，防止误删 LLM 关键字段）
  const handleDeleteRow = async (sheetId: string, rowIndex: number) => {
    if (!window.confirm(t("table_memory.confirm_delete_row"))) return;
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

  const handleKeyDown = (e: KeyboardEvent) => {
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

  // 重置默认表（带二次确认，覆盖现有数据）
  const handleResetToDefault = async () => {
    if (!window.confirm(t("table_memory.confirm_reset"))) return;
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

  // 删除整张表（带二次确认）
  const handleDeleteSheet = async (sheetId: string, sheetName: string) => {
    if (!window.confirm(t("table_memory.confirm_delete_sheet", { name: sheetName }))) return;
    const nextSheets = sheets.filter(s => s.id !== sheetId);
    await updateSheets(nextSheets);
    // 如果删除的是当前激活的 tab，切到第一张表
    if (activeTableTabId === sheetId) {
      setActiveTableTabId(nextSheets[0]?.id ?? "");
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 表结构编辑（新建/编辑表）——对应 TODO #1+#6 的表结构编辑能力
  // 关键：LLM 通过 PromptService.ts 动态读取 sheet.name/columns/rows 注入 Prompt，
  //       故此处表结构变更无需修改任何后端逻辑，LLM 会自动感知新结构。
  // ──────────────────────────────────────────────────────────────────────────

  // 进入"新建表"模式
  const startCreateSheet = () => {
    setSheetDraft({
      id: "new",
      name: "",
      description: "",
      columns: ["列1"]
    });
  };

  // 进入"编辑现有表"模式
  const startEditSheet = (sheet: TableMemorySheet) => {
    setSheetDraft({
      id: sheet.id,
      name: sheet.name,
      description: sheet.description ?? "",
      columns: [...sheet.columns]
    });
  };

  // 草稿列名变更
  const updateDraftColumn = (idx: number, value: string) => {
    if (!sheetDraft) return;
    const nextCols = [...sheetDraft.columns];
    nextCols[idx] = value;
    setSheetDraft({ ...sheetDraft, columns: nextCols });
  };

  // 草稿新增列
  const addDraftColumn = () => {
    if (!sheetDraft) return;
    setSheetDraft({
      ...sheetDraft,
      columns: [...sheetDraft.columns, `列${sheetDraft.columns.length + 1}`]
    });
  };

  // 草稿删除列（至少保留一列）
  const removeDraftColumn = (idx: number) => {
    if (!sheetDraft) return;
    if (sheetDraft.columns.length <= 1) {
      window.alert(t("table_memory.min_one_column"));
      return;
    }
    setSheetDraft({
      ...sheetDraft,
      columns: sheetDraft.columns.filter((_, i) => i !== idx)
    });
  };

  // 保存草稿（新建或更新）
  const saveDraft = async () => {
    if (!sheetDraft) return;
    const trimmedName = sheetDraft.name.trim();
    if (!trimmedName) {
      window.alert(t("table_memory.name_required"));
      return;
    }
    const trimmedCols = sheetDraft.columns.map(c => c.trim()).filter(c => c);
    if (trimmedCols.length === 0) {
      window.alert(t("table_memory.columns_required"));
      return;
    }

    if (sheetDraft.id === "new") {
      // 新建表：检查表名冲突
      if (sheets.some(s => s.name === trimmedName)) {
        window.alert(t("table_memory.duplicate_name", { name: trimmedName }));
        return;
      }
      const newSheet: TableMemorySheet = {
        id: `sheet_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: trimmedName,
        columns: trimmedCols,
        rows: [],
        enable: true,
        description: sheetDraft.description.trim() || undefined
      };
      const nextSheets = [...sheets, newSheet];
      await updateSheets(nextSheets);
      setActiveTableTabId(newSheet.id);
    } else {
      // 编辑现有表：检查表名冲突（排除自身）
      if (sheets.some(s => s.id !== sheetDraft.id && s.name === trimmedName)) {
        window.alert(t("table_memory.duplicate_name", { name: trimmedName }));
        return;
      }
      const nextSheets = sheets.map(s => {
        if (s.id === sheetDraft.id) {
          // 列结构变更时的行数据对齐策略：
          // 按列名匹配保留旧值（同名列继承数据），新增列或无匹配列补空字符串。
          // 这样：重命名列会丢失旧数据（符合"按名匹配"契约），新增列补空，删除列自然丢弃。
          const oldColumns = s.columns;
          const newColumns = trimmedCols;
          const newRows = s.rows.map(oldRow => {
            return newColumns.map(colName => {
              const oldIdx = oldColumns.indexOf(colName);
              return oldIdx !== -1 && oldRow[oldIdx] !== undefined ? oldRow[oldIdx] : "";
            });
          });
          return {
            ...s,
            name: trimmedName,
            columns: newColumns,
            rows: newRows,
            description: sheetDraft.description.trim() || undefined
          };
        }
        return s;
      });
      await updateSheets(nextSheets);
    }
    setSheetDraft(null);
  };

  const cancelDraft = () => {
    setSheetDraft(null);
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 渲染
  // ──────────────────────────────────────────────────────────────────────────

  return (
    <>
      {/* 管理按钮：从原 Header 迁移至此，控制内部 showConfig 状态 */}
      <div className="flex justify-end">
        <button
          onClick={() => {
            setShowConfig(!showConfig);
            setSheetDraft(null);
          }}
          className={`p-1.5 rounded-lg border text-[11px] font-semibold flex items-center gap-1 transition ${showConfig ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-muted border-border hover:bg-muted/80 text-muted-foreground'}`}
        >
          {t("table_memory.manage")}
        </button>
      </div>

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
              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border transition-all ${activeTableTabId === s.id
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
        sheetDraft ? (
          /* ─── 表结构编辑面板（新建/编辑共用） ─── */
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold font-mono text-muted-foreground">
                {sheetDraft.id === "new" ? t("table_memory.new_table") : t("table_memory.edit_table")}
              </span>
              <button
                onClick={cancelDraft}
                className="p-1 rounded text-muted-foreground hover:bg-muted"
                title={t("table_memory.cancel")}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* 表名 */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground block">{t("table_memory.form_name_label")}</label>
              <input
                value={sheetDraft.name}
                onChange={e => setSheetDraft({ ...sheetDraft, name: e.target.value })}
                placeholder={t("table_memory.form_name_placeholder")}
                className="w-full text-xs bg-background border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/30"
                autoFocus
              />
            </div>

            {/* 描述 */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground block">用途说明（可选）</label>
              <input
                value={sheetDraft.description}
                onChange={e => setSheetDraft({ ...sheetDraft, description: e.target.value })}
                placeholder="如：记录角色当前的心情与情绪变化"
                className="w-full text-xs bg-background border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/30"
              />
            </div>

            {/* 列定义 */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground block">{t("table_memory.form_columns_label")}</label>
              {sheetDraft.columns.map((col, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <input
                    value={col}
                    onChange={e => updateDraftColumn(idx, e.target.value)}
                    placeholder={`列 ${idx + 1}`}
                    className="flex-1 text-xs bg-background border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/30"
                  />
                  <button
                    onClick={() => removeDraftColumn(idx)}
                    className="p-2 rounded-lg text-destructive hover:bg-destructive/10 border border-destructive/20 transition"
                    title="删除此列"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <button
                onClick={addDraftColumn}
                className="text-xs font-bold text-primary bg-primary/10 border border-primary/25 hover:bg-primary/20 px-3 py-2 rounded-lg flex items-center gap-1.5 transition w-full justify-center"
              >
                <Plus className="w-4 h-4" /> 新增列
              </button>
            </div>

            {/* 编辑现有表时的数据对齐提示 */}
            {sheetDraft.id !== "new" && (
              <div className="text-[10px] text-muted-foreground bg-muted/30 border border-border/40 rounded-lg p-2 leading-relaxed">
                💡 {t("table_memory.column_edit_tip")}
              </div>
            )}

            {/* 保存 / 取消 */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={saveDraft}
                className="flex-1 text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/95 px-3 py-2.5 rounded-lg flex items-center justify-center gap-1.5 transition"
              >
                <Check className="w-4 h-4" /> {t("table_memory.save")}
              </button>
              <button
                onClick={cancelDraft}
                className="flex-1 text-xs font-bold bg-muted hover:bg-muted/80 text-muted-foreground border border-border px-3 py-2.5 rounded-lg transition"
              >
                {t("table_memory.cancel")}
              </button>
            </div>
          </div>
        ) : (
          /* ─── 默认管理视图 ─── */
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold font-mono text-muted-foreground">状态表格管理面板</span>
              <button
                onClick={handleResetToDefault}
                className="text-xs font-bold text-destructive bg-destructive/10 border border-destructive/20 hover:bg-destructive/20 px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition"
              >
                <RefreshCw className="w-3 h-3" /> {t("table_memory.reset_default")}
              </button>
            </div>

            {/* 新建自定义表按钮 */}
            <button
              onClick={startCreateSheet}
              className="w-full text-xs font-bold text-primary bg-primary/10 border border-primary/25 border-dashed hover:bg-primary/20 px-3 py-2.5 rounded-lg flex items-center justify-center gap-1.5 transition"
            >
              <Plus className="w-4 h-4" /> {t("table_memory.new_custom")}
            </button>

            {sheets.length === 0 ? (
              <div className="border border-dashed border-border/80 rounded-xl p-8 text-center text-muted-foreground flex flex-col items-center justify-center gap-2">
                <HelpCircle className="w-8 h-8 opacity-40" />
                <span className="text-xs font-bold">{t("table_memory.empty")}</span>
                <button
                  onClick={handleResetToDefault}
                  className="mt-2 text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/95 px-3 py-1.5 rounded-lg transition"
                >
                  {t("table_memory.init_defaults")}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {sheets.map(s => (
                  <div key={s.id} className="border border-border/80 bg-card/60 rounded-xl p-3 flex items-start justify-between gap-3 shadow-sm">
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
                      {/* 列名预览（最多 5 列） */}
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {s.columns.slice(0, 5).map((col, idx) => (
                          <span key={idx} className="text-[9px] px-1.5 py-0.5 bg-muted/40 border border-border/40 rounded text-muted-foreground">
                            {col}
                          </span>
                        ))}
                        {s.columns.length > 5 && (
                          <span className="text-[9px] px-1.5 py-0.5 text-muted-foreground">+{s.columns.length - 5}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => startEditSheet(s)}
                        className="p-1.5 rounded-lg border border-border bg-muted hover:bg-primary/10 hover:text-primary hover:border-primary/20 text-muted-foreground transition"
                        title="编辑表结构"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => toggleSheetEnabled(s.id)}
                        className={`p-1.5 rounded-lg border transition ${s.enable
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
                          : "bg-muted border-border text-muted-foreground opacity-60"
                          }`}
                        title={s.enable ? t("table_memory.enabled") : t("table_memory.disabled")}
                      >
                        {s.enable ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => handleDeleteSheet(s.id, s.name)}
                        className="p-1.5 rounded-lg border border-destructive/20 bg-destructive/10 hover:bg-destructive/20 text-destructive transition"
                        title={t("table_memory.delete_table")}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      ) : (
        /* ACTIVE TABLE SHEET RENDER */
        <>
          {!activeSheet ? (
            <div className="border border-dashed border-border/80 rounded-xl p-8 text-center text-muted-foreground flex flex-col items-center justify-center gap-2">
              <HelpCircle className="w-8 h-8 opacity-40" />
              <span className="text-xs font-bold">{t("table_memory.init_required")}</span>
              <button
                onClick={handleResetToDefault}
                className="mt-2 text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/95 px-3 py-1.5 rounded-lg transition"
              >
                {t("table_memory.one_click_init")}
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
                            {t("table_memory.no_rows")}
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
                                      <span className="break-all whitespace-pre-wrap text-[11px] leading-relaxed block flex-1" title={val}>{val || <span className="text-muted-foreground/30 font-light italic">{t("table_memory.empty_cell")}</span>}</span>
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
                                title={t("table_memory.delete_row")}
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
                  <Plus className="w-4 h-4" /> {t("table_memory.add_row")}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

export default TableMemoryTab;
