import React, { useContext, useState } from "react";
import { AppContext } from "../AppContext";
import { Trash2, Edit2, Book, ChevronDown, ChevronUp, Globe, User, Sparkles, Layers, RefreshCw, AlertCircle } from "lucide-react";
import { saveCharacter, saveGlobalLorebook } from "../utils/localDB";
import { LorebookEntry, CharacterCard } from "../types";

export default function GlobalWorldbookTab() {
  const {
    characters,
    setCharacters,
    setActiveTab,
    showCustomConfirm,
    editingActiveCharLoreEntry,
    setEditingActiveCharLoreEntry,
    activeCharacter,
    handleImportSillyLorebook,
    globalLorebook = [],
    setGlobalLorebook
  } = useContext(AppContext);

  const [expandedEntryIds, setExpandedEntryIds] = useState<Record<string, boolean>>({});

  const toggleExpand = (id: string) => {
    setExpandedEntryIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Switch an entry's scope (Global <=> Local) directly from the list
  const handleToggleScopeDirectly = async (entry: LorebookEntry, forceToGlobal: boolean) => {
    if (forceToGlobal) {
      // Move from character-bound list to global list
      if (activeCharacter) {
        const nextLocals = (activeCharacter.lorebookEntries || []).filter((e) => e.id !== entry.id);
        const updatedChar = { ...activeCharacter, lorebookEntries: nextLocals };
        setCharacters((prev: any[]) => prev.map((c) => c.id === updatedChar.id ? updatedChar : c));
        await saveCharacter(updatedChar);
      }
      
      const newGlobalEntry = { ...entry, isGlobal: true };
      const nextGlobals = [...globalLorebook];
      if (!nextGlobals.some(e => e.id === entry.id)) {
        nextGlobals.push(newGlobalEntry);
      }
      setGlobalLorebook(nextGlobals);
      await saveGlobalLorebook(nextGlobals);
    } else {
      // Move from global list to character-bound list
      if (!activeCharacter) {
        alert("⚠️ 请先在『角色馆』或对话中选择一个活动角色卡，才能转换为专属词条！");
        return;
      }
      
      const nextGlobals = globalLorebook.filter((e) => e.id !== entry.id);
      setGlobalLorebook(nextGlobals);
      await saveGlobalLorebook(nextGlobals);

      const newLocalEntry = { ...entry, isGlobal: false };
      const nextLocals = [...(activeCharacter.lorebookEntries || [])];
      if (!nextLocals.some(e => e.id === entry.id)) {
        nextLocals.push(newLocalEntry);
      }
      const updatedChar = { ...activeCharacter, lorebookEntries: nextLocals };
      setCharacters((prev: any[]) => prev.map((c) => c.id === updatedChar.id ? updatedChar : c));
      await saveCharacter(updatedChar);
    }
  };

  // Custom unified save function that respect the toggle choice
  const handleSaveEntryScopeConfigured = async () => {
    if (!editingActiveCharLoreEntry) return;
    const contentStr = editingActiveCharLoreEntry.content?.trim();
    if (!contentStr) {
      alert("⚠️ 设定事实内容不能为空");
      return;
    }

    const keysArr = Array.isArray(editingActiveCharLoreEntry.keys)
      ? editingActiveCharLoreEntry.keys
      : (editingActiveCharLoreEntry.keys as unknown as string).split(",").map((k) => k.trim()).filter(Boolean);

    const isEntryGlobal = !!editingActiveCharLoreEntry.isGlobal || !activeCharacter;

    const newEntry: LorebookEntry = {
      id: editingActiveCharLoreEntry.id || "le_" + Math.random().toString(36).substring(2, 9),
      keys: keysArr,
      content: contentStr,
      constant: !!editingActiveCharLoreEntry.constant,
      disabled: !!editingActiveCharLoreEntry.disabled,
      enabled: !editingActiveCharLoreEntry.disabled,
      comment: editingActiveCharLoreEntry.comment || "",
      useRegex: !!editingActiveCharLoreEntry.useRegex,
      addMemo: !!editingActiveCharLoreEntry.addMemo,
      probability: editingActiveCharLoreEntry.probability !== undefined ? Number(editingActiveCharLoreEntry.probability) : 100,
      order: editingActiveCharLoreEntry.order !== undefined ? Number(editingActiveCharLoreEntry.order) : 100,
      position: editingActiveCharLoreEntry.position || 'after_char_def',
      depth: editingActiveCharLoreEntry.depth !== undefined ? Number(editingActiveCharLoreEntry.depth) : 4,
      isGlobal: isEntryGlobal
    };

    if (isEntryGlobal) {
      // Save/Update in global list & delete from character-specific map if pre-exists
      const nextGlobals = [...globalLorebook];
      const idx = nextGlobals.findIndex(e => e.id === newEntry.id);
      if (idx >= 0) {
        nextGlobals[idx] = newEntry;
      } else {
        nextGlobals.push(newEntry);
      }
      setGlobalLorebook(nextGlobals);
      await saveGlobalLorebook(nextGlobals);

      if (activeCharacter) {
        const nextLocals = (activeCharacter.lorebookEntries || []).filter((e) => e.id !== newEntry.id);
        const updatedChar = { ...activeCharacter, lorebookEntries: nextLocals };
        setCharacters((prev: any[]) => prev.map((c) => c.id === updatedChar.id ? updatedChar : c));
        await saveCharacter(updatedChar);
      }
    } else {
      // Save/Update in character local & delete from global map if pre-exists
      if (activeCharacter) {
        const nextLocals = [...(activeCharacter.lorebookEntries || [])];
        const idx = nextLocals.findIndex(e => e.id === newEntry.id);
        if (idx >= 0) {
          nextLocals[idx] = newEntry;
        } else {
          nextLocals.push(newEntry);
        }
        const updatedChar = { ...activeCharacter, lorebookEntries: nextLocals };
        setCharacters((prev: any[]) => prev.map((c) => c.id === updatedChar.id ? updatedChar : c));
        await saveCharacter(updatedChar);

        const nextGlobals = globalLorebook.filter((e) => e.id !== newEntry.id);
        setGlobalLorebook(nextGlobals);
        await saveGlobalLorebook(nextGlobals);
      }
    }

    setEditingActiveCharLoreEntry(null);
  };

  // Compile full merged list of entries
  const localEntries = activeCharacter?.lorebookEntries || [];
  const mergedEntries = [
    ...localEntries.map(e => ({ ...e, isGlobal: false, ownerName: activeCharacter?.name })),
    ...(globalLorebook || []).map(e => ({ ...e, isGlobal: true, ownerName: "全局共用" }))
  ];

  return (
    <div className="p-4 space-y-4">
      <div className="border-b border-border pb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-sm font-bold text-foreground flex items-center gap-1.5">
            <Book className="w-4 h-4 text-primary" /> AI 记忆剧场 · 世界设定集 (Worldbook)
          </h1>
          <p className="text-xs text-muted-foreground font-light mt-1">
            设定包含两种形式：『全局设定』对所有角色卡全局生效；『专属设定』仅针对对应活跃角色。
          </p>
        </div>
        <div className="flex items-center gap-2 whitespace-nowrap">
          {activeCharacter && (
            <button
              onClick={() => setActiveTab("characters")}
              className="text-[10px] text-primary hover:text-primary font-bold bg-primary/10 border border-primary/20 px-2.5 py-1 rounded"
            >
              切换角色: {activeCharacter.name} 👤
            </button>
          )}
          <label className="cursor-pointer bg-input border border-border text-[10px] text-muted-foreground px-2.5 py-1 rounded active:scale-[0.98] hover:text-foreground transition text-center font-bold flex items-center gap-1">
            📥 导入酒馆世界书
            <input type="file" onChange={handleImportSillyLorebook} accept=".json" className="hidden" />
          </label>
        </div>
      </div>

      {/* Editor Panel */}
      {!editingActiveCharLoreEntry ? (
        <button
          onClick={() => setEditingActiveCharLoreEntry({
            id: "",
            comment: "",
            keys: [],
            content: "",
            constant: false,
            disabled: false,
            enabled: true,
            useRegex: false,
            addMemo: false,
            position: "after_char_def",
            depth: 4,
            order: 100,
            probability: 100,
            isGlobal: !activeCharacter, // Default to true if no active character
          })}
          className="w-full py-3.5 bg-muted/25 border-2 border-dashed border-border hover:border-primary/50 text-muted-foreground hover:text-primary rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition active:scale-[0.99]"
        >
          <span>➕ 新建世界设定词条</span>
        </button>
      ) : (
        <div className="bg-card p-4 rounded-xl border border-border space-y-4 shadow-sm text-xs animate-fadeIn">
          <div className="flex items-center justify-between border-b border-border/60 pb-2">
            <h3 className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
              {editingActiveCharLoreEntry?.id ? "✏️ 重修该项世界设定词条" : "➕ 新建世界设定词条"}
            </h3>
            <button 
              onClick={() => setEditingActiveCharLoreEntry(null)}
              className="text-muted-foreground hover:text-foreground text-[10px] transition"
            >
              [收起折叠 ×]
            </button>
          </div>

          <div className="space-y-3.5 text-xs">
            {/* Scope Slider/Toggle */}
            <div className="bg-muted/30 p-3 rounded-lg border border-border/40 space-y-2 select-none">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-blue-500" />
                  全局世界书生效模式 (对所有角色卡生效)
                </span>
                
                {/* Slidable Switch */}
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!editingActiveCharLoreEntry?.isGlobal || !activeCharacter}
                    disabled={!activeCharacter} // Force global if there's no active character
                    onChange={(e) => setEditingActiveCharLoreEntry({
                      ...editingActiveCharLoreEntry,
                      isGlobal: e.target.checked
                    })}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-border rounded-full peer peer-checked:bg-primary after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-card after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full peer-disabled:opacity-50"></div>
                </label>
              </div>
              <p className="text-[10px] text-muted-foreground leading-normal font-light">
                {!activeCharacter 
                  ? "💡 由于当前没有选定活跃专属伙伴，此条设定将被强制保存至『全局世界书』中供后续共用。"
                  : editingActiveCharLoreEntry?.isGlobal 
                    ? "✨ 开启后：该条设定属于全局词条，任何角色卡在对话时触发此关键词均能唤醒对应记忆。"
                    : `✨ 关闭后：该设定被锁定为（${activeCharacter.name}）的专属私密词条，其他角色卡对话时无法触发。`
                }
              </p>
            </div>

            {/* Part 1: Basic */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-muted-foreground mb-1 font-semibold">标题/备注 (如: 新条目 1)</label>
                <input
                  type="text"
                  placeholder="给这段设定起的一个别名或评论，方便管理"
                  value={editingActiveCharLoreEntry?.comment || ""}
                  onChange={(e) => setEditingActiveCharLoreEntry({ ...editingActiveCharLoreEntry, comment: e.target.value })}
                  className="w-full bg-input border border-border rounded p-2 text-foreground outline-none focus:border-primary font-medium transition"
                />
              </div>
              <div>
                <label className="block text-[11px] text-muted-foreground mb-1 font-semibold">主要关键词 (Key) (半角逗号分隔)</label>
                <input
                  type="text"
                  placeholder="圣言术, 圣骑士, 神学院"
                  value={editingActiveCharLoreEntry?.keys ? (Array.isArray(editingActiveCharLoreEntry.keys) ? editingActiveCharLoreEntry.keys.join(", ") : editingActiveCharLoreEntry.keys as unknown as string) : ""}
                  onChange={(e) => setEditingActiveCharLoreEntry({ ...editingActiveCharLoreEntry, keys: e.target.value as any })}
                  className="w-full bg-input border border-border rounded p-2 text-foreground outline-none focus:border-primary font-medium transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-muted-foreground mb-1 font-semibold">设定具体事实内容 (条目内容)</label>
              <textarea
                placeholder="这里描述这个物品、地理风貌或设定背景。例如：神圣学会的核心圣书，据说翻开时可聆听到古老的颂歌..."
                rows={4}
                value={editingActiveCharLoreEntry?.content || ""}
                onChange={(e) => setEditingActiveCharLoreEntry({ ...editingActiveCharLoreEntry, content: e.target.value })}
                className="w-full bg-input border border-border rounded p-2 text-foreground outline-none focus:border-primary resize-none leading-relaxed transition"
              />
            </div>

            {/* Part 1 Extra: Toggles */}
            <div className="flex flex-wrap gap-4 items-center bg-muted/30 p-2 rounded-lg border border-border/40 select-none">
              <label className="flex items-center gap-1.5 text-muted-foreground text-[10.5px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!editingActiveCharLoreEntry?.useRegex}
                  onChange={(e) => setEditingActiveCharLoreEntry({ ...editingActiveCharLoreEntry, useRegex: e.target.checked })}
                  className="accent-primary"
                />
                <span>启用正则 (Regex) 匹配</span>
              </label>
              <label className="flex items-center gap-1.5 text-muted-foreground text-[10.5px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!editingActiveCharLoreEntry?.addMemo}
                  onChange={(e) => setEditingActiveCharLoreEntry({ ...editingActiveCharLoreEntry, addMemo: e.target.checked })}
                  className="accent-primary"
                />
                <span>插入时包含标题备忘 (Add Memo)</span>
              </label>
            </div>

            {/* Part 2: Trigger & Activation & Positions */}
            <div className="border-t border-border/60 pt-3 space-y-3">
              <h4 className="text-[11px] font-bold text-muted-foreground flex items-center gap-1">② 触发、激活、插入与顺序 (Trigger, Activation, Insertion & Order)</h4>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-1">插入位置 (Position)</label>
                  <select
                    value={editingActiveCharLoreEntry?.position || "after_char_def"}
                    onChange={(e) => setEditingActiveCharLoreEntry({ ...editingActiveCharLoreEntry, position: e.target.value as any })}
                    className="w-full bg-input border border-border rounded p-1.5 text-foreground outline-none focus:border-primary text-xs"
                  >
                    <option value="after_char_def">📌 角色定义之后</option>
                    <option value="before_char_def">📌 角色定义之前</option>
                    <option value="top">📌 对话顶部 (System首)</option>
                    <option value="before_last_mes">💬 最新对话上方 (System尾)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-1">检测/扫描深度 (Depth)</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={editingActiveCharLoreEntry?.depth !== undefined ? editingActiveCharLoreEntry.depth : 4}
                    onChange={(e) => setEditingActiveCharLoreEntry({ ...editingActiveCharLoreEntry, depth: Number(e.target.value) })}
                    className="w-full bg-input border border-border rounded p-1.5 text-foreground outline-none focus:border-primary text-xs font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-1">排队顺序 (Order)</label>
                  <input
                    type="number"
                    value={editingActiveCharLoreEntry?.order !== undefined ? editingActiveCharLoreEntry.order : 100}
                    onChange={(e) => setEditingActiveCharLoreEntry({ ...editingActiveCharLoreEntry, order: Number(e.target.value) })}
                    className="w-full bg-input border border-border rounded p-1.5 text-foreground outline-none focus:border-primary text-xs font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-1">触发启用概率 (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={editingActiveCharLoreEntry?.probability !== undefined ? editingActiveCharLoreEntry.probability : 100}
                    onChange={(e) => setEditingActiveCharLoreEntry({ ...editingActiveCharLoreEntry, probability: Number(e.target.value) })}
                    className="w-full bg-input border border-border rounded p-1.5 text-foreground outline-none focus:border-primary text-xs font-semibold"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-4 items-center border border-border/30 bg-muted/20 p-2 rounded-lg select-none">
                <label className="flex items-center gap-1.5 text-muted-foreground text-[10.5px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!editingActiveCharLoreEntry?.constant}
                    onChange={(e) => setEditingActiveCharLoreEntry({ ...editingActiveCharLoreEntry, constant: e.target.checked })}
                    className="accent-primary"
                  />
                  <span>常驻强制注入 (Constant - 无视关键词)</span>
                </label>
                <label className="flex items-center gap-1.5 text-rose-400 text-[10.5px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!editingActiveCharLoreEntry?.disabled}
                    onChange={(e) => setEditingActiveCharLoreEntry({ ...editingActiveCharLoreEntry, disabled: e.target.checked })}
                    className="accent-primary"
                  />
                  <span className="font-semibold">禁用此词条 (Disable - 暂时睡眠该规则)</span>
                </label>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-end gap-2 border-t border-border/40 pt-2.5">
              <button
                onClick={() => setEditingActiveCharLoreEntry(null)}
                className="bg-muted hover:bg-muted/85 active:scale-[0.98] text-muted-foreground px-3.5 py-1.5 rounded-lg text-xs font-semibold"
              >
                收起折叠
              </button>
              <button
                onClick={handleSaveEntryScopeConfigured}
                disabled={!editingActiveCharLoreEntry?.content?.trim()}
                className="bg-primary hover:bg-primary/95 disabled:opacity-40 text-primary-foreground px-4 py-1.5 rounded-lg font-bold text-xs transition active:scale-[0.98]"
              >
                保存此词条设定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unified Worldbook entries listing */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border pb-1.5">
          <span className="font-bold text-primary flex items-center gap-1">
            <Layers className="w-3.5 h-3.5" /> 
            全部记忆词条目录 ({mergedEntries.length} 项 - 自动折叠，点击展开查看)
          </span>
          <span className="text-[10px] font-light">
            {activeCharacter ? `其中包括 (${localEntries.length}) 专属，(${globalLorebook.length}) 全局` : `暂无活动宿体，(${globalLorebook.length}) 全局生效`}
          </span>
        </div>

        {mergedEntries.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground border border-dashed border-border/80 rounded-xl italic text-xs">
            ✨ 世界书目录中空空如也。点击上方的新建按钮或导入按钮加入您的第一条设定吧！
          </div>
        ) : (
          <div className="space-y-2.5">
            {mergedEntries.map((entry) => {
              const isExpanded = !!expandedEntryIds[entry.id];
              const entryName = entry.comment || (entry.keys && entry.keys.length > 0 ? entry.keys.join(", ") : "") || "未命名世界设定词条";

              return (
                <div
                  key={entry.id}
                  className={`bg-card rounded-xl border text-xs transition-all duration-200 ${
                    entry.disabled
                      ? "border-dashed border-red-900/15 bg-red-950/2 opacity-65"
                      : isExpanded
                      ? "border-primary/50 ring-1 ring-primary/20 shadow-sm"
                      : "border-border/80 hover:border-border/100"
                  }`}
                >
                  {/* Compact Header (Always Visible) */}
                  <div
                    onClick={() => toggleExpand(entry.id)}
                    className="p-3 flex items-center justify-between cursor-pointer select-none gap-2"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-muted-foreground shrink-0 text-sm">
                        {isExpanded ? "📂" : "📁"}
                      </span>
                      <span className="font-semibold text-foreground truncate max-w-[140px] sm:max-w-[280px]">
                        {entryName}
                      </span>

                      {/* Scope Badge (Global or Person Spec) */}
                      {entry.isGlobal ? (
                        <span className="bg-sky-950/20 text-sky-400 border border-thin border-sky-900/30 px-1.5 py-0.2 rounded text-[9px] shrink-0 font-bold flex items-center gap-0.5">
                          <Globe className="w-2.5 h-2.5" /> 全局
                        </span>
                      ) : (
                        <span className="bg-amber-950/20 text-amber-500 border border-thin border-amber-900/30 px-1.5 py-0.2 rounded text-[9px] shrink-0 font-bold flex items-center gap-0.5">
                          <User className="w-2.5 h-2.5" /> 专属: {entry.ownerName}
                        </span>
                      )}

                      {/* Small Status tags */}
                      <div className="flex items-center gap-1 shrink-0">
                        {entry.constant && (
                          <span className="bg-emerald-950/25 text-emerald-400 border border-emerald-900/30 px-1 py-0.2 rounded text-[9px] scale-[0.9]">
                            常驻
                          </span>
                        )}
                        {entry.disabled && (
                          <span className="bg-rose-950/25 text-rose-400 border border-rose-900/30 px-1 py-0.2 rounded text-[9px] scale-[0.9]">
                            已禁用
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0" onClick={(e) => e.stopPropagation()}>
                      {/* Interactive toggle switch for fast global switching */}
                      <div className="flex items-center gap-1 select-none pr-1">
                        <span className="text-[10px] text-muted-foreground hidden md:inline">全局共享:</span>
                        <label className="relative inline-flex items-center cursor-pointer scale-[0.85]">
                          <input
                            type="checkbox"
                            checked={entry.isGlobal}
                            onChange={(e) => handleToggleScopeDirectly(entry, e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-8 h-4 bg-border rounded-full peer peer-checked:bg-primary after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-card after:border-border after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:after:translate-x-full"></div>
                        </label>
                      </div>

                      <div className="text-muted-foreground shrink-0">
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-muted-foreground/85" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-muted-foreground/85" />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Collapsible Content */}
                  {isExpanded && (
                    <div className="px-3.5 pb-3.5 pt-1 border-t border-border/40 space-y-3 animate-fadeIn text-xs">
                      {/* Meta details list */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-muted/20 p-2.5 rounded-lg text-[10px] text-muted-foreground font-mono">
                        <div>
                          <span className="text-muted-foreground/75">触发主要关键词: </span>
                          <span className="text-foreground font-semibold">
                            {entry.keys && entry.keys.length > 0 ? entry.keys.join(", ") : "(无)"}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground/75">插入位置: </span>
                          <span className="text-foreground font-semibold">
                            {entry.position === "after_char_def"
                              ? "📌 角色定义之后"
                              : entry.position === "before_char_def"
                              ? "📌 角色定义之前"
                              : entry.position === "top"
                              ? "📌 对话顶部 System首"
                              : "💬 最新消息 System尾"}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground/75">扫描深度 / 权重: </span>
                          <span className="text-foreground font-semibold">
                            {entry.depth !== undefined ? entry.depth : 4} / {entry.order !== undefined ? entry.order : 100}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground/75">概率 / Regex: </span>
                          <span className="text-foreground font-semibold">
                            {entry.probability !== undefined ? entry.probability : 100}% / {entry.useRegex ? "启用" : "未启用"}
                          </span>
                        </div>
                      </div>

                      {/* Fact text paragraph panel */}
                      <div className="space-y-1">
                        <span className="block text-[10px] text-muted-foreground font-semibold flex items-center gap-0.5">
                          <Sparkles className="w-3 h-3 text-amber-500" />
                          设定叙述内容 (将被直接写入 Prompt 上下文):
                        </span>
                        <p className={`font-light leading-relaxed whitespace-pre-wrap rounded-lg bg-muted/40 p-2.5 border border-border/40 text-[11px] ${entry.disabled ? "line-through text-muted-foreground/50 bg-red-950/2" : "text-muted-foreground"}`}>
                          {entry.content}
                        </p>
                      </div>

                      {/* Footer actions inside card */}
                      <div className="flex items-center justify-between pt-1 border-t border-border/30">
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {entry.addMemo ? "⭐ 带有标题备忘备注" : ""}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              setEditingActiveCharLoreEntry({ ...entry });
                              window.scrollTo({ top: 0, behavior: "smooth" });
                            }}
                            className="text-[11px] bg-primary/10 hover:bg-primary/20 text-primary border border-primary/25 px-2.5 py-1 rounded-md flex items-center gap-1 font-semibold transition"
                            title="修改设定"
                          >
                            <Edit2 className="w-3 h-3" /> 编辑此条设定
                          </button>
                          <button
                            onClick={async () => {
                              const ok = await showCustomConfirm("确定擦除该条世界设定词词条吗？");
                              if (ok) {
                                if (entry.isGlobal) {
                                  // Delete global
                                  const next = globalLorebook.filter((g) => g.id !== entry.id);
                                  setGlobalLorebook(next);
                                  await saveGlobalLorebook(next);
                                } else if (activeCharacter) {
                                  // Delete local bound
                                  const next = (activeCharacter.lorebookEntries || []).filter((g) => g.id !== entry.id);
                                  const updatedChar = { ...activeCharacter, lorebookEntries: next };
                                  setCharacters((prev: any[]) => prev.map((c) => c.id === updatedChar.id ? updatedChar : c));
                                  await saveCharacter(updatedChar);
                                }
                              }
                            }}
                            className="text-[11px] bg-rose-950/20 hover:bg-rose-950/45 text-red-400 border border-thin border-rose-900/35 px-2.5 py-1 rounded-md flex items-center gap-1 transition"
                          >
                            <Trash2 className="w-3 h-3" /> 擦除
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
