import { useState, useEffect } from "react";
import { ChatSession } from "../../types";
import { useKernel } from "../../contexts/KernelContext";
import type { MemoryServiceTyped } from "../../kernel/services/memory";
import { useTranslation } from "../../contexts/LanguageContext";
import {
  RefreshCw,
  BookOpen,
  Edit3,
  Check,
  Info,
  Search,
  Plus,
  Trash2,
  Download,
  X,
  AlertCircle
} from "lucide-react";

export interface DictTabProps {
  activeSession: ChatSession;
}

const ENTITY_TYPES = [
  { value: "all", labelKey: "dict_tab.type_all" },
  { value: "character", labelKey: "dict_tab.type_character" },
  { value: "location", labelKey: "dict_tab.type_location" },
  { value: "item", labelKey: "dict_tab.type_item" },
  { value: "organization", labelKey: "dict_tab.type_organization" },
  { value: "concept", labelKey: "dict_tab.type_concept" },
];

function DictTab({ activeSession }: DictTabProps) {
  const { t } = useTranslation();
  const kernel = useKernel();
  const getMemoryStorage = () => kernel.getService<MemoryServiceTyped>("memory").getStorage();
  
  // 核心数据状态
  const [dictEntries, setDictEntries] = useState<any[]>([]);
  const [isLoadingDict, setIsLoadingDict] = useState(false);

  // 搜索与过滤状态
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState("all");

  // 行编辑别名状态
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editAliasesText, setEditAliasesText] = useState("");
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);

  // 手动新增词条状态
  const [isAdding, setIsAdding] = useState(false);
  const [newEntity, setNewEntity] = useState("");
  const [newType, setNewType] = useState("concept");
  const [newAliasesText, setNewAliasesText] = useState("");
  const [isSavingNew, setIsSavingNew] = useState(false);

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

  // 保存修改后的别名
  const handleSaveAliases = async (entityName: string, entry: any) => {
    const aliases = editAliasesText
      .split(/[,，\s]+/)
      .map(s => s.trim())
      .filter(Boolean);
    try {
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

  // 手动新增实体词条
  const handleSaveNewEntry = async () => {
    const name = newEntity.trim();
    if (!name) {
      alert(t("dict_tab.entity_name_required"));
      return;
    }
    
    // 避免同名冲突
    const isDuplicate = dictEntries.some(
      entry => entry.entity.toLowerCase() === name.toLowerCase()
    );
    if (isDuplicate) {
      alert(t("dict_tab.duplicate_entity", { name }));
      return;
    }

    setIsSavingNew(true);
    try {
      const aliases = newAliasesText
        .split(/[,，\s]+/)
        .map(s => s.trim())
        .filter(Boolean);

      await getMemoryStorage().upsertDictEntry(
        activeSession.id,
        name,
        {
          type: newType,
          aliases,
          firstSeenMsgId: "manual",
          firstSeenTurn: 0,
          count: 1,
        }
      );

      // 重置状态与列表重新加载
      setIsAdding(false);
      setNewEntity("");
      setNewType("concept");
      setNewAliasesText("");
      await loadDict();
    } catch (err) {
      console.error("Failed to add new entry:", err);
    } finally {
      setIsSavingNew(false);
    }
  };

  // 手动删除实体词条
  const handleDeleteEntry = async (entry: any) => {
    if (!window.confirm(t("dict_tab.confirm_delete_entry", { entity: entry.entity }))) {
      return;
    }
    try {
      await getMemoryStorage().deleteDictEntry(entry.id);
      await loadDict();
    } catch (err) {
      console.error("Failed to delete entry:", err);
    }
  };

  // 批量导出词典为 JSON 纯净包
  const handleExportDict = () => {
    if (dictEntries.length === 0) return;
    
    const exportable = dictEntries.map(entry => ({
      entity: entry.entity,
      type: entry.type,
      aliases: entry.aliases || [],
      count: entry.count || 1,
      firstSeenTurn: entry.firstSeenTurn || 0,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }));
    
    const json = JSON.stringify(exportable, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement("a");
    a.href = url;
    const safeTitle = (activeSession.title || t("session_manager.default_branch_name")).replace(/[^\w\u4e00-\u9fa5]/g, "_").slice(0, 20);
    a.download = `${safeTitle}_记忆词典.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 实体类型映射
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
      case 'character': return t("dict_tab.type_character");
      case 'location': return t("dict_tab.type_location");
      case 'item': return t("dict_tab.type_item");
      case 'organization': return t("dict_tab.type_organization");
      default: return t("dict_tab.type_concept");
    }
  };

  // 进行实时搜索与类型筛选
  const filteredEntries = dictEntries.filter(entry => {
    if (selectedType !== "all" && entry.type !== selectedType) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const nameMatch = entry.entity.toLowerCase().includes(q);
      const aliasMatch = Array.isArray(entry.aliases) && entry.aliases.some((a: string) => a.toLowerCase().includes(q));
      return nameMatch || aliasMatch;
    }
    return true;
  });

  return (
    <div className="space-y-3 text-xs text-foreground">
      
      {/* 顶部简短提示 */}
      <div className="rounded-lg border border-border/30 bg-muted/30 px-2.5 py-2 text-[10px] font-medium leading-4 text-muted-foreground">
        {t("dict_tab.info")}
      </div>

      {/* 搜索栏与新增/导出操作按钮 */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <div className="relative min-w-0">
          <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder={t("dict_tab.search_placeholder")}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-input pl-8 pr-7 text-xs outline-none focus:ring-2 focus:ring-primary/20"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setIsAdding(!isAdding)}
            className={`flex min-h-9 items-center justify-center gap-1 rounded-lg border px-2.5 text-[11px] font-bold transition ${
              isAdding
                ? "bg-rose-950/20 text-rose-400 border-rose-900/35 hover:bg-rose-950/30"
                : "bg-primary/10 text-primary border-primary/20 hover:bg-primary/15"
            }`}
          >
            {isAdding ? (
              <>
                <X className="w-3.5 h-3.5" />
                {t("dict_tab.close_form")}
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                {t("dict_tab.add_entry")}
              </>
            )}
          </button>
          {dictEntries.length > 0 && (
            <button
              onClick={handleExportDict}
              className="flex min-h-9 items-center gap-1 rounded-lg border border-border bg-muted px-2.5 text-[11px] font-bold text-muted-foreground transition hover:border-primary/20 hover:bg-primary/10 hover:text-primary"
              title={t("dict_tab.export_dict_title")}
            >
              <Download className="w-3.5 h-3.5" />
              {t("dict_tab.export_dict")}
            </button>
          )}
        </div>
      </div>

      {/* 手动添加词条卡片 */}
      {isAdding && (
        <div className="animate-in space-y-2.5 rounded-xl border border-primary/20 bg-muted/30 p-2.5 fade-in slide-in-from-top-1 duration-200">
          <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
            <span className="font-bold text-primary flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" /> {t("dict_tab.new_entry_title")}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-muted-foreground text-[10px] mb-1 font-bold">{t("dict_tab.form_name_label")}</label>
              <input
                type="text"
                placeholder={t("dict_tab.form_name_placeholder")}
                value={newEntity}
                onChange={e => setNewEntity(e.target.value)}
                className="w-full bg-input border border-border rounded px-2 py-1 outline-none text-xs"
              />
            </div>
            <div>
              <label className="block text-muted-foreground text-[10px] mb-1 font-bold">{t("dict_tab.form_type_label")}</label>
              <select
                value={newType}
                onChange={e => setNewType(e.target.value)}
                className="w-full bg-input border border-border rounded px-2 py-1 outline-none text-xs"
              >
                <option value="character">👤 人物 (Character)</option>
                <option value="location">📍 地点 (Location)</option>
                <option value="item">🎒 物品 (Item)</option>
                <option value="organization">🛡️ 组织 (Organization)</option>
                <option value="concept">💡 概念 (Concept)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-muted-foreground text-[10px] mb-1 font-bold">{t("dict_tab.form_aliases_label")}</label>
            <input
              type="text"
              placeholder={t("dict_tab.form_aliases_placeholder")}
              value={newAliasesText}
              onChange={e => setNewAliasesText(e.target.value)}
              className="w-full bg-input border border-border rounded px-2 py-1 outline-none text-xs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1 border-t border-border/20">
            <button
              onClick={() => {
                setIsAdding(false);
                setNewEntity("");
                setNewAliasesText("");
              }}
              className="px-3 py-1 border border-border rounded hover:bg-muted text-muted-foreground font-semibold"
            >
              {t("dict_tab.cancel")}
            </button>
            <button
              onClick={handleSaveNewEntry}
              disabled={isSavingNew}
              className="px-3.5 py-1 bg-primary text-primary-foreground hover:opacity-90 rounded font-bold flex items-center gap-1 disabled:opacity-50"
            >
              {isSavingNew ? (
                <>
                  <RefreshCw className="w-3 h-3 animate-spin" /> {t("dict_tab.saving")}
                </>
              ) : (
                <>
                  <Check className="w-3 h-3" /> {t("dict_tab.confirm_save")}
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* 分类过滤标签页 */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 custom-scrollbar shrink-0">
        {ENTITY_TYPES.map(type => {
          const count = type.value === "all" 
            ? dictEntries.length
            : dictEntries.filter(e => e.type === type.value).length;
            
          const active = selectedType === type.value;
          return (
            <button
              key={type.value}
              onClick={() => setSelectedType(type.value)}
              className={`px-2.5 py-1 rounded-full text-[10px] font-bold border transition flex items-center gap-1 shrink-0 ${
                active
                  ? "bg-primary/20 border-primary text-primary"
                  : "bg-muted/40 border-border/45 text-muted-foreground hover:bg-muted/65"
              }`}
            >
              <span>{t(type.labelKey)}</span>
              <span className={`px-1 rounded-full text-[9px] ${
                active ? "bg-primary/30 text-primary" : "bg-muted/80 text-muted-foreground/70"
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* 词条列表渲染 */}
      {isLoadingDict ? (
        <div className="py-12 text-center text-xs text-muted-foreground font-medium flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" /> {t("dict_tab.loading")}
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 px-5 py-6 text-center text-muted-foreground">
          <BookOpen className="size-7 opacity-35" />
          <span className="text-xs font-bold">{t("dict_tab.no_match")}</span>
          <p className="text-[10px] max-w-xs text-muted-foreground/75 mt-1">
            {searchQuery || selectedType !== "all"
              ? t("dict_tab.no_match_tip_filter")
              : t("dict_tab.no_match_tip_empty")}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredEntries.map(entry => {
            const isEditing = editingEntryId === entry.id;
            return (
              <div
                key={entry.id}
                className="border border-border/40 bg-card/25 rounded-xl p-2.5 flex flex-col gap-2 transition hover:border-border/70 hover:bg-card/45"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-bold text-foreground">
                        {getEntityTypeIcon(entry.type)} {entry.entity}
                      </span>
                      <span className="text-[9px] font-mono font-bold bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                        {t("dict_tab.mention_count", { count: entry.count })}
                      </span>
                      <span className="text-[9px] font-medium border border-border/50 text-muted-foreground px-1.5 py-0.5 rounded bg-muted/30">
                        {getEntityTypeLabel(entry.type)}
                      </span>
                    </div>

                    {/* 别名显示 */}
                    {!isEditing && (
                      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                        <span className="text-[9px] text-muted-foreground/70 shrink-0">{t("dict_tab.aliases_label")}</span>
                        {Array.isArray(entry.aliases) && entry.aliases.length > 0 ? (
                          entry.aliases.map((a: string, idx: number) => (
                            <span
                              key={idx}
                              className="text-[9px] font-semibold bg-primary/5 border border-primary/10 text-primary px-1.5 py-0.5 rounded"
                            >
                              {a}
                            </span>
                          ))
                        ) : (
                          <span className="text-[9px] text-muted-foreground/40 italic">{t("dict_tab.no_aliases")}</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 常态右侧操作栏 */}
                  {!isEditing && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setExpandedEntryId(expandedEntryId === entry.id ? null : entry.id)}
                        className={`p-1 rounded transition ${
                          expandedEntryId === entry.id
                            ? "bg-primary/15 text-primary"
                            : "text-muted-foreground hover:bg-muted"
                        }`}
                        title={t("dict_tab.view_detail")}
                      >
                        <Info className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          setEditingEntryId(entry.id);
                          setEditAliasesText((entry.aliases || []).join(", "));
                        }}
                        className="p-1 rounded text-muted-foreground hover:bg-muted hover:text-primary transition"
                        title={t("dict_tab.edit_aliases")}
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteEntry(entry)}
                        className="p-1 rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition"
                        title={t("dict_tab.delete_entry_title")}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* 详情卡片折叠展开 */}
                {expandedEntryId === entry.id && (
                  <div className="text-[10px] space-y-1.5 bg-muted/20 border border-border/30 rounded-lg p-2 font-medium text-muted-foreground leading-relaxed animate-in fade-in slide-in-from-top-1 duration-150">
                    <div className="flex justify-between">
                      <span>{t("dict_tab.detail_first_seen")}</span>
                      <span className="font-semibold text-foreground">
                        {entry.firstSeenMsgId === "manual" ? (
                          <span className="text-primary font-bold">{t("dict_tab.detail_manual")}</span>
                        ) : (
                          t("dict_tab.detail_turn", { turn: entry.firstSeenTurn + 1 })
                        )}
                      </span>
                    </div>
                    {entry.createdAt && (
                      <div className="flex justify-between">
                        <span>{t("dict_tab.detail_created")}</span>
                        <span className="font-semibold text-foreground">
                          {new Date(entry.createdAt).toLocaleString("zh-CN")}
                        </span>
                      </div>
                    )}
                    {entry.updatedAt && (
                      <div className="flex justify-between">
                        <span>{t("dict_tab.detail_updated")}</span>
                        <span className="font-semibold text-foreground">
                          {new Date(entry.updatedAt).toLocaleString("zh-CN")}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* 别名行内编辑 */}
                {isEditing && (
                  <div className="flex items-center gap-1.5 border-t border-border/20 pt-2 bg-muted/5 p-1 rounded-lg">
                    <input
                      value={editAliasesText}
                      onChange={e => setEditAliasesText(e.target.value)}
                      placeholder={t("dict_tab.edit_placeholder")}
                      className="flex-1 text-[10.5px] bg-background border border-border px-2 py-1 rounded focus:outline-none focus:ring-1 focus:ring-primary/20"
                    />
                    <button
                      onClick={() => handleSaveAliases(entry.entity, entry)}
                      className="px-2 py-1 text-[10px] font-bold bg-primary text-primary-foreground rounded hover:bg-primary/95 flex items-center gap-0.5 shadow-sm"
                    >
                      <Check className="w-3 h-3" /> {t("dict_tab.save")}
                    </button>
                    <button
                      onClick={() => setEditingEntryId(null)}
                      className="px-2 py-1 text-[10px] font-bold border border-border rounded text-muted-foreground hover:bg-muted"
                    >
                      {t("dict_tab.cancel")}
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
