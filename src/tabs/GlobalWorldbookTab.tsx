import React, { useContext, useState } from "react";
import { AppContext } from "../AppContext";
import { 
  Trash2, Edit2, Book, ChevronDown, ChevronUp, Globe, User, 
  Sparkles, Search, Save, X, Plus, Folder, FolderOpen, ArrowRight, Upload, HelpCircle, Archive
} from "lucide-react";
import { saveCharacter, saveGlobalLorebook } from "../utils/localDB";
import { LorebookEntry, CharacterCard } from "../types";

export default function GlobalWorldbookTab() {
  const {
    characters = [],
    setCharacters,
    setActiveTab,
    showCustomConfirm,
    activeCharacter,
    handleImportSillyLorebook,
    globalLorebook = [],
    setGlobalLorebook,
    activeWorldbookHostId,
    setActiveWorldbookHostId
  } = useContext(AppContext);

  // Active Selected Host ID: "global" or the specific ID of a character card
  const activeHostId = activeWorldbookHostId || "global";
  const setActiveHostId = setActiveWorldbookHostId;

  // Search local to the active directory/folder
  const [searchQuery, setSearchQuery] = useState("");

  // Accordion Expanded State for child entries of the select host folder
  const [expandedEntryIds, setExpandedEntryIds] = useState<Record<string, boolean>>({});
  
  // Inline Editor State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<LorebookEntry> & { 
    isGlobal?: boolean; 
    targetOwnerId?: string; 
  }>({});

  // Compile stats
  const globalCount = globalLorebook?.length || 0;
  const characterStats = characters.map(c => ({
    id: c.id,
    name: c.name,
    avatar: c.avatar,
    count: c.lorebookEntries?.length || 0
  }));

  // Retrieve current active host object
  const activeChar = characters.find(c => c.id === activeHostId);
  const activeHostName = activeHostId === "global" ? "🌎 全局共用词库" : `👤 【${activeChar?.name || "未知宿体"}】专属回路`;

  // Get raw child entries list for the active host folder
  const activeHostRawEntries: LorebookEntry[] = activeHostId === "global" 
    ? (globalLorebook || []) 
    : (activeChar?.lorebookEntries || []);

  // Filter child entries inside this host folder by search query
  const filteredChildEntries = activeHostRawEntries.filter((entry) => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return true;
    
    const matchComment = (entry.comment || "").toLowerCase().includes(query);
    const matchContent = (entry.content || "").toLowerCase().includes(query);
    const matchKeys = (entry.keys || []).some(k => k.toLowerCase().includes(query));
    return matchComment || matchContent || matchKeys;
  });

  const toggleExpand = (id: string) => {
    if (editingId === id) return; // Prevent collapse/expand when editing inline 
    setExpandedEntryIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Convert key inputs (string) to arrays
  const parseKeys = (val: string | string[]): string[] => {
    if (Array.isArray(val)) return val;
    return val.split(",").map(k => k.trim()).filter(Boolean);
  };

  // Switch an entry's host/scope directly inside editing form or quick move dropdown
  const handleMoveScope = async (entry: LorebookEntry, fromHostId: string, toHostId: string) => {
    if (fromHostId === toHostId) return;

    // Standard raw copy of lore entry
    const cleanEntry: LorebookEntry = {
      id: entry.id,
      keys: entry.keys || [],
      content: entry.content || "",
      constant: !!entry.constant,
      disabled: !!entry.disabled,
      enabled: !entry.disabled,
      comment: entry.comment || "",
      useRegex: !!entry.useRegex,
      addMemo: !!entry.addMemo,
      probability: entry.probability !== undefined ? entry.probability : 100,
      order: entry.order !== undefined ? entry.order : 100,
      position: entry.position || "after_char_def",
      depth: entry.depth !== undefined ? entry.depth : 4
    };

    // 1. Delete from source host
    let nextGlobals = [...globalLorebook];
    if (fromHostId === "global") {
      nextGlobals = nextGlobals.filter(e => e.id !== entry.id);
    } else {
      const srcChar = characters.find(c => c.id === fromHostId);
      if (srcChar) {
        const nextLocals = (srcChar.lorebookEntries || []).filter(e => e.id !== entry.id);
        const updated = { ...srcChar, lorebookEntries: nextLocals };
        setCharacters((prev: CharacterCard[]) => prev.map(c => c.id === srcChar.id ? updated : c));
        await saveCharacter(updated);
      }
    }

    // 2. Add to destination host
    if (toHostId === "global") {
      if (!nextGlobals.some(e => e.id === entry.id)) {
        nextGlobals.push(cleanEntry);
      }
      setGlobalLorebook(nextGlobals);
      await saveGlobalLorebook(nextGlobals);
    } else {
      const destChar = characters.find(c => c.id === toHostId);
      if (destChar) {
        const nextLocals = [...(destChar.lorebookEntries || [])];
        if (!nextLocals.some(e => e.id === entry.id)) {
          nextLocals.push(cleanEntry);
        }
        const updated = { ...destChar, lorebookEntries: nextLocals };
        setGlobalLorebook(nextGlobals);
        await saveGlobalLorebook(nextGlobals);
        setCharacters((prev: CharacterCard[]) => prev.map(c => c.id === destChar.id ? updated : c));
        await saveCharacter(updated);
      }
    }

    // Reset editing
    setEditingId(null);
    setEditForm({});
  };

  // Launch editing in-place inside the list item itself
  const startInlineEdit = (entry: LorebookEntry) => {
    setEditingId(entry.id);
    setEditForm({
      id: entry.id,
      comment: entry.comment || "",
      keys: entry.keys || [],
      content: entry.content || "",
      constant: !!entry.constant,
      disabled: !!entry.disabled,
      useRegex: !!entry.useRegex,
      addMemo: !!entry.addMemo,
      position: entry.position || "after_char_def",
      depth: entry.depth !== undefined ? entry.depth : 4,
      order: entry.order !== undefined ? entry.order : 100,
      probability: entry.probability !== undefined ? entry.probability : 100,
      isGlobal: activeHostId === "global",
      targetOwnerId: activeHostId === "global" ? "" : activeHostId
    });
    setExpandedEntryIds(prev => ({ ...prev, [entry.id]: true }));
  };

  // Save Inline editing changes
  const handleSaveInlineEntry = async (id: string) => {
    if (!editForm.content?.trim()) {
      alert("⚠️ 设定叙述内容不能为空");
      return;
    }

    const nextKeys = parseKeys(editForm.keys || []);
    const entryDataId = id.startsWith("new_inline_temp") 
      ? "le_" + Math.random().toString(36).substring(2, 9) 
      : id;

    const baseEntry: LorebookEntry = {
      id: entryDataId,
      keys: nextKeys,
      content: editForm.content.trim(),
      comment: editForm.comment || "",
      constant: !!editForm.constant,
      disabled: !!editForm.disabled,
      enabled: !editForm.disabled,
      useRegex: !!editForm.useRegex,
      addMemo: !!editForm.addMemo,
      position: editForm.position || "after_char_def",
      depth: editForm.depth !== undefined ? Number(editForm.depth) : 4,
      order: editForm.order !== undefined ? Number(editForm.order) : 100,
      probability: editForm.probability !== undefined ? Number(editForm.probability) : 100
    };

    // Determine target host based on user choices inside form
    const isGlobalSelected = !!editForm.isGlobal || !characters || characters.length === 0;
    const targetHostId = isGlobalSelected ? "global" : (editForm.targetOwnerId || characters[0]?.id);

    // Swap hosts if changing! Check if it's a completely new one
    if (id.startsWith("new_inline_temp")) {
      // Just save to target directly
      if (targetHostId === "global") {
        const nextGlobals = [...globalLorebook, baseEntry];
        setGlobalLorebook(nextGlobals);
        await saveGlobalLorebook(nextGlobals);
      } else {
        const targetChar = characters.find(c => c.id === targetHostId);
        if (targetChar) {
          const nextLocals = [...(targetChar.lorebookEntries || []), baseEntry];
          const updated = { ...targetChar, lorebookEntries: nextLocals };
          setCharacters((prev: CharacterCard[]) => prev.map(c => c.id === targetChar.id ? updated : c));
          await saveCharacter(updated);
        }
      }
    } else {
      // It is an update! Might have changed destination host relative to currently selected activeHostId
      if (activeHostId === targetHostId) {
        // Simple update in current host
        if (activeHostId === "global") {
          const nextGlobals = globalLorebook.map(e => e.id === entryDataId ? baseEntry : e);
          setGlobalLorebook(nextGlobals);
          await saveGlobalLorebook(nextGlobals);
        } else {
          const targetChar = characters.find(c => c.id === activeHostId);
          if (targetChar) {
            const nextLocals = (targetChar.lorebookEntries || []).map(e => e.id === entryDataId ? baseEntry : e);
            const updated = { ...targetChar, lorebookEntries: nextLocals };
            setCharacters((prev: CharacterCard[]) => prev.map(c => c.id === targetChar.id ? updated : c));
            await saveCharacter(updated);
          }
        }
      } else {
        // Scope actually shifted! Use transfer logic
        await handleMoveScope(baseEntry, activeHostId, targetHostId);
      }
    }

    setEditingId(null);
    setEditForm({});
  };

  const startNewInlineEntry = () => {
    const tempId = "new_inline_temp_creator";
    setEditingId(tempId);
    setEditForm({
      id: tempId,
      comment: "",
      keys: [],
      content: "",
      constant: false,
      disabled: false,
      useRegex: false,
      addMemo: false,
      position: "after_char_def",
      depth: 4,
      order: 100,
      probability: 100,
      isGlobal: activeHostId === "global",
      targetOwnerId: activeHostId === "global" ? (characters[0]?.id || "") : activeHostId
    });
    setExpandedEntryIds(prev => ({ ...prev, [tempId]: true }));
  };

  const handleDeleteEntry = async (entry: LorebookEntry) => {
    const ok = await showCustomConfirm(`确定要删除此条世界设定 [${entry.comment || entry.keys[0] || "未命名"}] 吗？`);
    if (!ok) return;

    if (activeHostId === "global") {
      const next = globalLorebook.filter(e => e.id !== entry.id);
      setGlobalLorebook(next);
      await saveGlobalLorebook(next);
    } else {
      const srcChar = characters.find(c => c.id === activeHostId);
      if (srcChar) {
        const nextLocals = (srcChar.lorebookEntries || []).filter(e => e.id !== entry.id);
        const updated = { ...srcChar, lorebookEntries: nextLocals };
        setCharacters((prev: CharacterCard[]) => prev.map(c => c.id === srcChar.id ? updated : c));
        await saveCharacter(updated);
      }
    }
  };

  return (
    <div className="p-4 space-y-4">
      {/* 1. Header with Title & Import Utilities */}
      <div className="border-b border-border pb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-sm font-bold text-foreground flex items-center gap-1.5">
            <Book className="w-4 h-4 text-primary animate-pulse" /> 宿体隔离世界设定集 · Worldbook
          </h1>
          <p className="text-xs text-muted-foreground font-light mt-1">
            设定根据特定的附属宿体进行物理隔离，单独点击宿体以查阅其下属词条，绝不在主列表中混淆。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeCharacter && (
            <button
              onClick={() => {
                // Instantly swap directory switch to active character tab folder
                setActiveHostId(activeCharacter.id);
              }}
              className="text-[10.5px] text-primary hover:text-primary-foreground hover:bg-primary font-bold bg-primary/10 border border-primary/25 px-2.5 py-1.5 rounded-lg transition"
            >
              当前交谈角色: {activeCharacter.name} 👤
            </button>
          )}
          <label className="cursor-pointer bg-card border border-border text-[10.5px] text-muted-foreground px-2.5 py-1.5 rounded-lg active:scale-[0.98] hover:text-foreground hover:border-border transition text-center font-bold flex items-center gap-1">
            📥 导入酒馆世界书 (.json)
            <input type="file" onChange={handleImportSillyLorebook} accept=".json" className="hidden" />
          </label>
        </div>
      </div>

      {/* 2. Structured Dossier Folder Splitting Layout */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-start">
        
        {/* LEFT COLUMN: Folders Directory */}
        <div className="col-span-1 space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold text-muted-foreground flex items-center gap-1">
              📂 宿体名录 (Folders)
            </span>
            <span className="bg-muted px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold text-muted-foreground">
              {characters.length + 1} 个分类
            </span>
          </div>

          <div className="space-y-1.5 max-h-[500px] overflow-y-auto pr-1">
            {/* Global Folder Card Button */}
            <button
              onClick={() => {
                setActiveHostId("global");
                setEditingId(null);
                setSearchQuery("");
              }}
              className={`w-full text-left p-3 rounded-xl border transition-all flex items-center justify-between ${
                activeHostId === "global"
                  ? "bg-primary/10 border-primary text-primary shadow-sm"
                  : "bg-card border-border hover:border-border/80 text-foreground"
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Globe className={`w-4 h-4 shrink-0 ${activeHostId === "global" ? "text-primary" : "text-sky-400"}`} />
                <div className="min-w-0">
                  <p className="text-xs font-bold truncate">🌎 全局共用词库</p>
                  <p className="text-[10px] text-muted-foreground font-light mt-0.5">所有角色通用记忆柜</p>
                </div>
              </div>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                activeHostId === "global" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}>
                {globalCount}
              </span>
            </button>

            {/* Divider line */}
            <div className="border-t border-border/40 my-2" />

            {/* Character Specific Folders */}
            {characters.length === 0 ? (
              <div className="text-center py-6 px-3 border border-dashed border-border/60 rounded-xl bg-muted/5 text-[11px] text-muted-foreground italic">
                暂未检索到有效的角色宿体。请在「宿体配置」中新建人物卡！
              </div>
            ) : (
              characters.map((char) => {
                const isSelected = activeHostId === char.id;
                const entryCount = char.lorebookEntries?.length || 0;

                return (
                  <button
                    key={char.id}
                    onClick={() => {
                      setActiveHostId(char.id);
                      setEditingId(null);
                      setSearchQuery("");
                    }}
                    className={`w-full text-left p-3 rounded-xl border transition-all flex items-center justify-between ${
                      isSelected
                        ? "bg-primary/10 border-primary text-primary shadow-sm"
                        : "bg-card border-border hover:border-border hover:bg-card/90 text-foreground"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {char.avatar ? (
                        <img 
                          src={char.avatar} 
                          alt={char.name} 
                          className="w-4 h-4 rounded-full object-cover shrink-0"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <User className={`w-4 h-4 shrink-0 ${isSelected ? "text-primary" : "text-amber-500"}`} />
                      )}
                      
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate">{char.name}</p>
                        <p className="text-[10px] text-muted-foreground font-light mt-0.5">专属独立回路记忆</p>
                      </div>
                    </div>
                    
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                      isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    }`}>
                      {entryCount}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Selected Host Isolated Workspace */}
        <div className="col-span-1 md:col-span-3 space-y-3 bg-card/65 p-4 rounded-2xl border border-border/80 shadow-inner min-h-[460px]">
          
          {/* Active Folder Dossier Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-primary/10 rounded-xl">
                {activeHostId === "global" ? (
                  <Globe className="w-4 h-4 text-primary animate-spin-slow" />
                ) : (
                  <FolderOpen className="w-4 h-4 text-primary" />
                )}
              </div>
              <div>
                <h2 className="text-xs font-bold font-mono text-foreground flex items-center gap-1.5">
                  {activeHostName}
                </h2>
                <p className="text-[10px] text-muted-foreground font-light mt-0.5">
                  {activeHostId === "global" 
                    ? "此处展示的是系统大局公用语汇。在任何会话满足召唤钥匙时都会装配载入。"
                    : `此处展示仅针对「${activeChar?.name}」的专属记忆事实，隔离在外部私有区，不会泄露给其他伙伴。`
                  }
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {editingId !== "new_inline_temp_creator" && (
                <button
                  onClick={startNewInlineEntry}
                  className="bg-primary hover:bg-primary/95 text-primary-foreground px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 transition active:scale-[0.98] shadow-sm select-none"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>新建专属独立设定</span>
                </button>
              )}
            </div>
          </div>

          {/* Search bar specifically target the selected active host */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-muted-foreground" />
            <input
              type="text"
              placeholder={`在 [ ${activeHostId === "global" ? "全局共用" : activeChar?.name} ] 中搜索设定标题、触发词或叙述...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-input border border-border rounded-lg pl-8 p-1.5 outline-none focus:border-primary text-xs text-foreground font-medium"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-2 text-muted-foreground hover:text-foreground text-[10px]"
              >
                清除
              </button>
            )}
          </div>

          {/* Inline Creator Slot inside workspace */}
          {editingId === "new_inline_temp_creator" && (
            <div className="bg-card p-4 rounded-xl border border-primary/40 text-xs animate-fadeIn space-y-3 shadow-md">
              <div className="flex items-center justify-between border-b border-border/60 pb-1.5">
                <h3 className="font-bold text-primary flex items-center gap-1">
                  ✨ 增添世界词条 · {activeHostId === "global" ? "全局" : activeChar?.name}
                </h3>
                <button 
                  onClick={() => { setEditingId(null); setEditForm({}); }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {renderInlineForm("new_inline_temp_creator")}
            </div>
          )}

          {/* Unified Entries List scoped ONLY to the selected host */}
          <div className="space-y-2.5">
            <div className="text-[10px] text-muted-foreground flex items-center justify-between">
              <span className="font-bold">
                已检索到该分类下成果共 ({filteredChildEntries.length}) 项设定
              </span>
            </div>

            {filteredChildEntries.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground border border-dashed border-border/80 rounded-xl italic text-xs bg-muted/5 space-y-2">
                <p>📭 暂未发现匹配的世界设定记录。</p>
                <p className="text-[10.5px] text-muted-foreground font-light max-w-sm mx-auto">
                  此目录当前为空白。您可以点击右上角「新建专属独立设定」按钮在此宿体柜内手工筑新设定。
                </p>
              </div>
            ) : (
              filteredChildEntries.map((entry) => {
                const isExpanded = !!expandedEntryIds[entry.id];
                const isEditingType = editingId === entry.id;
                const entryLabel = entry.comment || (entry.keys && entry.keys.slice(0, 3).join(", ")) || "未命名设定";

                return (
                  <div
                    key={entry.id}
                    className={`bg-card rounded-xl border text-xs transition-all duration-200 ${
                      entry.disabled
                        ? "border-dashed border-red-900/10 bg-red-950/2 opacity-60"
                        : isEditingType
                        ? "border-primary ring-1 ring-primary/40 shadow-sm"
                        : isExpanded
                        ? "border-primary/30"
                        : "border-border/80 hover:border-border"
                    }`}
                  >
                    {/* Collapsible Header */}
                    <div
                      onClick={() => toggleExpand(entry.id)}
                      className="p-3 flex flex-col gap-2 cursor-pointer select-none"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-muted-foreground shrink-0 text-xs">
                            {isExpanded ? "📂" : "📁"}
                          </span>
                          <span className="font-semibold text-foreground truncate max-w-[140px] sm:max-w-[280px] text-[12.5px]">
                            {entryLabel}
                          </span>

                          {/* Badges */}
                          <div className="flex items-center gap-1 shrink-0 scale-90">
                            {entry.constant && (
                              <span className="bg-amber-950/25 text-amber-500 border border-amber-900/15 px-1.5 py-0.2 rounded text-[9px]">
                                常驻
                              </span>
                            )}
                            {entry.disabled && (
                              <span className="bg-rose-950/25 text-rose-400 border border-rose-900/15 px-1.5 py-0.2 rounded text-[9px]">
                                禁用
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 text-muted-foreground text-[11px]" onClick={(e) => e.stopPropagation()}>
                          <span className="text-[10px] opacity-75 hidden md:inline">
                            {entry.keys && entry.keys.length > 0 ? `${entry.keys.length}个触发词` : "常驻"}
                          </span>
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </div>
                      </div>

                      {/* BELOW LINE (下面一行): Colored Blue or Green containing depth and other attributes */}
                      <div className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10.5px] font-semibold leading-none ${
                        activeHostId === "global" 
                          ? "text-sky-500 dark:text-sky-450" 
                          : "text-emerald-500 dark:text-emerald-450"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          activeHostId === "global" ? "bg-sky-500 animate-pulse" : "bg-emerald-500 animate-pulse"
                        }`} />
                        <span>位置: {
                          entry.position === "after_char_def" ? "📌角色后" :
                          entry.position === "before_char_def" ? "📌角色前" :
                          entry.position === "top" ? "📌最顶部" : "💬发言上"
                        }</span>
                        <span className="text-muted-foreground/35">|</span>
                        <span>插入深度: {entry.depth !== undefined ? entry.depth : 4}</span>
                        <span className="text-muted-foreground/35">|</span>
                        <span>编排优先级: {entry.order !== undefined ? entry.order : 100}</span>
                        <span className="text-muted-foreground/35">|</span>
                        <span>触发率: {entry.probability !== undefined ? entry.probability : 100}%</span>
                        {entry.useRegex && (
                          <>
                            <span className="text-muted-foreground/35">|</span>
                            <span className="font-mono text-[9px] uppercase px-1 py-0.1 bg-current/10 rounded">Regex</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Expand Panel */}
                    {isExpanded && (
                      <div className="px-3.5 pb-3.5 pt-2 border-t border-border/20 space-y-3 animate-fadeIn text-xs">
                        {!isEditingType ? (
                          <>
                            {/* 🔥 TOP OPTIONS PANEL (移至最上方) */}
                            <div className="flex items-center justify-between pb-2.5 border-b border-border/20">
                              <span className="text-[10.5px] text-muted-foreground font-light flex items-center gap-1.5">
                                {entry.addMemo ? "⭐ 带标题备忘" : ""}
                                {entry.useRegex ? "🌀 正则匹配" : ""}
                              </span>
                              
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() => startInlineEdit(entry)}
                                  className="text-[11px] bg-primary/10 hover:bg-primary hover:text-primary-foreground text-primary border border-primary/20 px-3 py-1.5 rounded-lg flex items-center gap-1 font-semibold transition select-none"
                                >
                                  <Edit2 className="w-3.5 h-3.5" /> 编辑词条
                                </button>
                                <button
                                  onClick={() => handleDeleteEntry(entry)}
                                  className="text-[11px] bg-rose-500/10 hover:bg-rose-600 hover:text-white text-rose-500 border border-rose-500/20 px-3 py-1.5 rounded-lg flex items-center gap-1 font-semibold transition select-none"
                                >
                                  <Trash2 className="w-3.5 h-3.5" /> 删除设定
                                </button>
                              </div>
                            </div>

                            {/* Meta Grid info */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-muted/20 p-2.5 rounded-lg text-[10.5px] text-muted-foreground font-mono">
                              <div>
                                <span className="text-muted-foreground/75">触发关键词: </span>
                                <span className="text-foreground font-medium">
                                  {entry.keys && entry.keys.length > 0 ? entry.keys.join(", ") : "(空)"}
                                </span>
                              </div>
                              <div>
                                <span className="text-muted-foreground/75">插入位置: </span>
                                <span className="text-foreground font-medium">
                                  {entry.position === "after_char_def" ? "角色定义后" : entry.position === "before_char_def" ? "角色定义前" : entry.position === "top" ? "对话最顶部" : "最新发言上方"}
                                </span>
                              </div>
                              <div>
                                <span className="text-muted-foreground/75">优先级 / 深度: </span>
                                <span className="text-foreground font-medium">{entry.order !== undefined ? entry.order : 100} / {entry.depth !== undefined ? entry.depth : 4}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground/75">触发概率: </span>
                                <span className="text-foreground font-medium">{entry.probability !== undefined ? entry.probability : 100}%</span>
                              </div>
                            </div>

                            {/* Narrative content block */}
                            <div className="space-y-1">
                              <span className="block text-[10.2px] text-muted-foreground font-bold flex items-center gap-0.5">
                                <Sparkles className="w-3 h-3 text-amber-500 animate-pulse" />
                                设定叙述内容 (System Prompt 混编注入):
                              </span>
                              <p className={`font-light leading-relaxed whitespace-pre-wrap rounded-lg bg-muted/40 p-2.5 border border-border/40 text-[11px] ${entry.disabled ? "line-through text-muted-foreground/50 bg-red-950/2" : "text-muted-foreground/90 font-medium"}`}>
                                {entry.content}
                              </p>
                            </div>
                          </>
                        ) : (
                          /* Active inline editor form right inside current card directory item */
                          <div className="space-y-3.5 pt-1.5 animate-fadeIn">
                            {renderInlineForm(entry.id)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );

  // Reusable inline template editor for creating and editing records inside dossier scopes
  function renderInlineForm(id: string) {
    const isNew = id.startsWith("new_inline_temp");

    return (
      <div className="space-y-3.5 text-xs animate-fadeIn">
        
        {/* Dossier Scope / Host Selector Switcher with Slider */}
        <div className="p-3 bg-muted/30 border border-border/80 rounded-xl space-y-3.5 select-none animate-fadeIn">
          <div className="flex items-center justify-between p-2 bg-input border border-border/50 rounded-xl">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-bold text-foreground flex items-center gap-1">
                🌎 全局共享设定 (Universal / Share to All Characters)
              </span>
              <span className="text-[10.5px] text-muted-foreground font-light">
                开启后为通用词条，所有宿体角色对话时都会共享此脑路记忆
              </span>
            </div>

            {/* Switch Slider (滑块) */}
            <button
              type="button"
              role="switch"
              aria-checked={!!editForm.isGlobal}
              onClick={() => {
                setEditForm(prev => {
                  const toGlobal = !prev.isGlobal;
                  return {
                    ...prev,
                    isGlobal: toGlobal,
                    targetOwnerId: toGlobal ? "" : (prev.targetOwnerId || characters[0]?.id || "")
                  };
                });
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                editForm.isGlobal ? 'bg-primary' : 'bg-muted/80'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow-lg ring-0 transition duration-200 ease-in-out ${
                  editForm.isGlobal ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {!editForm.isGlobal && characters.length > 0 && (
            <div className="mt-1.5 text-xs space-y-1.5 animate-fadeIn">
              <label className="block text-[11px] text-muted-foreground font-bold">🎯 选择该专属记忆锁定的特定宿体:</label>
              <select
                value={editForm.targetOwnerId || characters[0]?.id}
                onChange={(e) => setEditForm(prev => ({ ...prev, targetOwnerId: e.target.value }))}
                className="w-full bg-input border border-border rounded-lg p-2 text-foreground text-xs font-semibold outline-none focus:border-primary"
              >
                {characters.map(c => (
                  <option key={c.id} value={c.id}>👤 专属关联: {c.name}</option>
                ))}
              </select>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground leading-normal font-light">
            通过在此处更改“共享滑块”，您可以随时让本条记忆在【全局通用】与【角色专属】之间一键切换。
          </p>
        </div>

        {/* Basics comments & key triggers */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1 font-bold">设定标题或备注名称 *</label>
            <input
              type="text"
              placeholder="例如: 契约魔法, 隐秘圣堂"
              value={editForm.comment || ""}
              onChange={(e) => setEditForm(prev => ({ ...prev, comment: e.target.value }))}
              className="w-full bg-input border border-border rounded-lg p-2 text-foreground outline-none focus:border-primary font-medium transition"
            />
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1 font-bold">触发唤醒词 (半角逗号间隔拼写)</label>
            <input
              type="text"
              placeholder="契约, 咒印, 终焉"
              value={editForm.keys ? (Array.isArray(editForm.keys) ? editForm.keys.join(", ") : editForm.keys as unknown as string) : ""}
              onChange={(e) => setEditForm(prev => ({ ...prev, keys: e.target.value as any }))}
              className="w-full bg-input border border-border rounded-lg p-2 text-foreground outline-none focus:border-primary font-medium transition"
            />
          </div>
        </div>

        {/* Narrative description */}
        <div>
          <label className="block text-[11px] text-muted-foreground mb-1 font-bold">设定补充叙述具体事实叙事内容 *</label>
          <textarea
            placeholder="具体的记忆描述。当对话中触发关键词时，系统会自动提取拼混入 AI 对局 Prompt 内。例如：契约魔法源自古尔德大王，施法时需要在掌心画出五角芒芒印，且饮下一滴生灵血..."
            rows={4}
            value={editForm.content || ""}
            onChange={(e) => setEditForm(prev => ({ ...prev, content: e.target.value }))}
            className="w-full bg-input border border-border rounded-lg p-2 text-foreground outline-none focus:border-primary resize-none leading-relaxed font-normal transition"
          />
        </div>

        {/* Match Rule settings */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 border border-border/40 p-2 rounded-lg bg-muted/10">
          <label className="flex items-center gap-1.5 text-muted-foreground text-[10.5px] cursor-pointer">
            <input
              type="checkbox"
              checked={!!editForm.useRegex}
              onChange={(e) => setEditForm(prev => ({ ...prev, useRegex: e.target.checked }))}
              className="accent-primary"
            />
            <span>启用正则匹配 (Regex)</span>
          </label>
          <label className="flex items-center gap-1.5 text-muted-foreground text-[10.5px] cursor-pointer">
            <input
              type="checkbox"
              checked={!!editForm.addMemo}
              onChange={(e) => setEditForm(prev => ({ ...prev, addMemo: e.target.checked }))}
              className="accent-primary"
            />
            <span>合并包含标题别名</span>
          </label>
          <label className="flex items-center gap-1.5 text-muted-foreground text-[10.5px] cursor-pointer">
            <input
              type="checkbox"
              checked={!!editForm.constant}
              onChange={(e) => setEditForm(prev => ({ ...prev, constant: e.target.checked }))}
              className="accent-primary"
            />
            <span>常驻强制注入设定</span>
          </label>
          <label className="flex items-center gap-1.5 text-rose-400 text-[10.5px] cursor-pointer">
            <input
              type="checkbox"
              checked={!!editForm.disabled}
              onChange={(e) => setEditForm(prev => ({ ...prev, disabled: e.target.checked }))}
              className="accent-primary"
            />
            <span className="font-semibold">临时禁用本条词</span>
          </label>
        </div>

        {/* Advanced trigger conditions */}
        <div className="border-t border-border/50 pt-2.5 space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <div>
              <label className="block text-[10px] text-muted-foreground mb-1">插入位置 (Position)</label>
              <select
                value={editForm.position || "after_char_def"}
                onChange={(e) => setEditForm(prev => ({ ...prev, position: e.target.value as any }))}
                className="w-full bg-input border border-border rounded-lg p-1.5 text-foreground text-xs"
              >
                <option value="after_char_def">📌 角色定义之后</option>
                <option value="before_char_def">📌 角色定义之前</option>
                <option value="top">📌 对话最顶部</option>
                <option value="before_last_mes">💬 最新发言上方</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-muted-foreground mb-1">检索后推深度 (Depth)</label>
              <input
                type="number"
                min={1}
                value={editForm.depth !== undefined ? editForm.depth : 4}
                onChange={(e) => setEditForm(prev => ({ ...prev, depth: Number(e.target.value) }))}
                className="w-full bg-input border border-border rounded-lg p-1.5 text-foreground text-xs font-semibold"
              />
            </div>
            <div>
              <label className="block text-[10px] text-muted-foreground mb-1">编排权重次序 (Order)</label>
              <input
                type="number"
                value={editForm.order !== undefined ? editForm.order : 100}
                onChange={(e) => setEditForm(prev => ({ ...prev, order: Number(e.target.value) }))}
                className="w-full bg-input border border-border rounded-lg p-1.5 text-foreground text-xs font-semibold"
              />
            </div>
            <div>
              <label className="block text-[10px] text-muted-foreground mb-1">唤起触发概率 (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                value={editForm.probability !== undefined ? editForm.probability : 100}
                onChange={(e) => setEditForm(prev => ({ ...prev, probability: Number(e.target.value) }))}
                className="w-full bg-input border border-border rounded-lg p-1.5 text-foreground text-xs font-semibold"
              />
            </div>
          </div>
        </div>

        {/* Actions inside form */}
        <div className="flex items-center justify-end gap-2 border-t border-border/40 pt-2.5">
          <button
            onClick={() => {
              setEditingId(null);
              setEditForm({});
            }}
            type="button"
            className="bg-muted hover:bg-muted/80 active:scale-[0.98] text-muted-foreground px-3.5 py-1.5 rounded-lg text-xs font-semibold transition"
          >
            取消
          </button>
          <button
            onClick={() => handleSaveInlineEntry(id)}
            disabled={!editForm.content?.trim()}
            type="button"
            className="bg-primary hover:bg-primary/95 disabled:opacity-45 text-primary-foreground px-4 py-1.5 rounded-lg text-xs font-bold transition active:scale-[0.98] flex items-center gap-1 shadow-sm font-mono"
          >
            <Save className="w-3.5 h-3.5" />
            <span>保存到此柜</span>
          </button>
        </div>
      </div>
    );
  }
}
