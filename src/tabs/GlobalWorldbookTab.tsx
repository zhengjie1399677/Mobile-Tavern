import React, { useContext } from "react";
import { AppContext } from "../AppContext";
import { Trash2, Edit2, Book } from "lucide-react";

import { saveCharacter } from "../utils/localDB";












export default function GlobalWorldbookTab() {
  const { characters, setCharacters, setActiveTab, showCustomConfirm, editingActiveCharLoreEntry, setEditingActiveCharLoreEntry, activeCharacter, handleImportSillyLorebook, handleSaveActiveCharLoreEntry } = useContext(AppContext);
  return (
    
          <div className="p-4 space-y-4">
            {!activeCharacter ? (
              <div className="p-8 text-center max-w-sm mx-auto space-y-4 mt-8">
                <div className="w-16 h-16 bg-muted border border-border rounded-full flex items-center justify-center mx-auto shadow-lg">
                  <Book className="w-8 h-8 text-stone-650 text-stone-550" />
                </div>
                <h3 className="text-base font-bold text-muted-foreground">暂无活动角色卡</h3>
                <p className="text-xs text-muted-foreground leading-normal">
                  世界书并非全局共用设定，而是每个角色卡单独存储。请前往对话流或角色馆，选定一个活跃角色伙伴，随后即可在此处为其重编专属故事和背景词条。
                </p>
                <div className="pt-2">
                  <button
                    onClick={() => setActiveTab("characters")}
                    className="bg-primary hover:bg-primary text-primary-foreground px-5 py-2 rounded-lg text-xs font-bold transition duration-200"
                  >
                    前往角色宿体馆 🚀
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4 animate-fadeIn">
                <div className="border-b border-border pb-3 flex items-center justify-between">
                  <div>
                    <h1 className="text-sm font-bold text-foreground flex items-center gap-1.5">
                      <Book className="w-4 h-4 text-primary" /> AI 专属世界设定集 ({activeCharacter.name})
                    </h1>
                    <p className="text-xs text-muted-foreground font-light mt-1">
                      词条保存在当前活跃角色卡内。在后续会话中提及对应关键词时，将自动注入上下文以加温记忆。
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 whitespace-nowrap">
                    <button
                      onClick={() => setActiveTab("characters")}
                      className="text-[10px] text-primary hover:text-primary font-bold bg-primary/10 border border-primary/20 px-2.5 py-1 rounded"
                    >
                      切换宿体 👤
                    </button>
                    <label className="cursor-pointer bg-input border border-border text-[10px] text-muted-foreground px-2.5 py-1 rounded active:scale-[0.98] hover:text-foreground transition text-center font-bold flex items-center gap-1">
                      📥 导入酒馆世界书
                      <input type="file" onChange={handleImportSillyLorebook} accept=".json" className="hidden" />
                    </label>
                  </div>
                </div>

                {/* Create / Edit inline entry for selected active character */}
                <div className="bg-card p-4 rounded-xl border border-border space-y-4 shadow-sm text-xs">
                  <h3 className="text-xs font-bold text-muted-foreground flex items-center gap-1.5 border-b border-border/65 pb-2">
                    {editingActiveCharLoreEntry?.id ? "✏️ 重修该项世界设定词条" : "➕ 新建角色专属特定词条"}
                  </h3>
                  <div className="space-y-3.5 text-xs">
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
                        rows={3}
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
                      {editingActiveCharLoreEntry && (
                        <button
                          onClick={() => setEditingActiveCharLoreEntry(null)}
                          className="bg-muted hover:bg-muted/85 active:scale-[0.98] text-muted-foreground px-3.5 py-1.5 rounded-lg text-xs"
                        >
                          取消
                        </button>
                      )}
                      <button
                        onClick={handleSaveActiveCharLoreEntry}
                        disabled={!editingActiveCharLoreEntry?.content?.trim()}
                        className="bg-primary hover:bg-primary/95 disabled:opacity-40 text-primary-foreground px-4 py-1.5 rounded-lg font-bold text-xs transition"
                      >
                        保存条目设定
                      </button>
                    </div>
                  </div>
                </div>

                {/* Entries Listing under parent character card */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-bold text-primary">已包含的专属知识词条 ({activeCharacter.lorebookEntries?.length || 0} 项)</span>
                  </div>

                  {activeCharacter.lorebookEntries?.map((entry) => (
                    <div key={entry.id} className={`bg-card p-3.5 rounded-xl border text-xs transition ${entry.disabled ? "border-dashed border-red-900/40 bg-red-950/5 opacity-60" : "border-border/80"}`}>
                      <div className="flex items-center justify-between border-b border-border/60 pb-2 mb-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {entry.comment && (
                            <span className="bg-amber-950/20 text-amber-500 font-bold px-1.5 py-0.5 rounded border border-amber-900/30 text-[10px]">
                              📝 {entry.comment}
                            </span>
                          )}
                          {!entry.constant && entry.keys.map((k) => (
                            <span key={k} className="bg-primary/10 text-primary/80 px-1.5 py-0.5 rounded border border-primary/20 text-[10px]">
                              🔑 {k}
                            </span>
                          ))}
                          {entry.useRegex && <span className="bg-purple-950/20 text-purple-400 px-1.5 py-0.5 rounded border border-purple-900/30 text-[9px]">Regex</span>}
                          {entry.constant && <span className="bg-emerald-950/20 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-900/30 text-[9px]">常驻项</span>}
                          {entry.disabled && <span className="bg-rose-950/30 text-rose-400 px-1.5 py-0.5 rounded border border-rose-900/40 text-[9px]">已禁用</span>}
                        </div>
                        <div className="flex gap-1 animate-fadeIn">
                          <button
                            onClick={() => setEditingActiveCharLoreEntry({ ...entry })}
                            className="text-muted-foreground hover:text-foreground p-0.5 transition"
                            title="重修条目"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={async () => {
                              const ok = await showCustomConfirm("确定擦除该条专属词条设定？");
                              if (ok) {
                                const next = (activeCharacter.lorebookEntries || []).filter((g) => g.id !== entry.id);
                                const updatedChar = { ...activeCharacter, lorebookEntries: next };
                                setCharacters((prev) => prev.map((c) => c.id === updatedChar.id ? updatedChar : c));
                                await saveCharacter(updatedChar);
                              }
                            }}
                            className="text-red-400/85 hover:text-red-400 p-0.5 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Entry Facts Details Meta Row */}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground mb-1.5 opacity-80 font-mono">
                        {entry.position && (
                          <span>位置: {
                            entry.position === 'after_char_def' ? "📌角色定义后" :
                            entry.position === 'before_char_def' ? "📌角色定义前" :
                            entry.position === 'top' ? "📌指令顶部" : "💬最新消息上方"
                          }</span>
                        )}
                        {entry.depth !== undefined && <span>扫描深度: {entry.depth}</span>}
                        {entry.order !== undefined && <span>权重: {entry.order}</span>}
                        {entry.probability !== undefined && entry.probability < 100 && <span>触发概率: {entry.probability}%</span>}
                        {entry.addMemo && <span className="text-amber-500/90">带备注 (Memo)</span>}
                      </div>

                      <p className={`font-light leading-relaxed whitespace-pre-wrap ${entry.disabled ? "line-through text-muted-foreground/55" : "text-muted-foreground"}`}>{entry.content}</p>
                    </div>
                  ))}

                  {(!activeCharacter.lorebookEntries || activeCharacter.lorebookEntries.length === 0) && (
                    <div className="text-center py-10 text-muted-foreground border border-dashed border-border/80 rounded-xl italic">
                      暂无专属世界设定，请在上方或在角色修改窗口完成录入配置。
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        
  );
}
