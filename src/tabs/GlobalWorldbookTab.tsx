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
                <div className="bg-card p-3.5 rounded-xl border border-border space-y-3">
                  <h3 className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
                    {editingActiveCharLoreEntry?.id ? "✏️ 重修该项世界设定词条" : "➕ 新建角色专属特定词条"}
                  </h3>
                  <div className="space-y-2.5 text-xs">
                    <div>
                      <label className="block text-[11px] text-muted-foreground mb-1 font-semibold">触发词 (半角逗号分隔，如: [匕首, 圣器])</label>
                      <input
                        type="text"
                        placeholder="圣言术, 圣骑士, 神学院"
                        value={editingActiveCharLoreEntry?.keys ? (Array.isArray(editingActiveCharLoreEntry.keys) ? editingActiveCharLoreEntry.keys.join(", ") : editingActiveCharLoreEntry.keys as unknown as string) : ""}
                        onChange={(e) => setEditingActiveCharLoreEntry({ ...editingActiveCharLoreEntry, keys: e.target.value as any })}
                        className="w-full bg-input border border-border rounded p-2 text-foreground outline-none focus:border-primary font-medium transition"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-muted-foreground mb-1 font-semibold">设定具体事实内容 (当检测到触发词时将被拼入背景)</label>
                      <textarea
                        placeholder="这里描述这个物品、地理风貌或设定背景。例如：神圣学会的核心圣书，据说翻开时可聆听到古老的颂歌..."
                        rows={3}
                        value={editingActiveCharLoreEntry?.content || ""}
                        onChange={(e) => setEditingActiveCharLoreEntry({ ...editingActiveCharLoreEntry, content: e.target.value })}
                        className="w-full bg-input border border-border rounded p-2 text-foreground outline-none focus:border-primary resize-none leading-relaxed transition"
                      />
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <label className="flex items-center gap-1.5 text-muted-foreground text-[10.5px] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!editingActiveCharLoreEntry?.constant}
                          onChange={(e) => setEditingActiveCharLoreEntry({ ...editingActiveCharLoreEntry, constant: e.target.checked })}
                          className="accent-primary"
                        />
                        <span>常驻判定设定集内无需触发检索</span>
                      </label>
                      <div className="flex gap-1.5">
                        {editingActiveCharLoreEntry && (
                          <button
                            onClick={() => setEditingActiveCharLoreEntry(null)}
                            className="bg-muted active:scale-[0.98] text-muted-foreground px-3 py-1 rounded-lg text-xs"
                          >
                            取消
                          </button>
                        )}
                        <button
                          onClick={handleSaveActiveCharLoreEntry}
                          disabled={!editingActiveCharLoreEntry?.content?.trim()}
                          className="bg-primary hover:bg-primary disabled:opacity-40 text-primary-foreground px-3.5 py-1 rounded-lg font-bold text-xs transition"
                        >
                          保存极速录入
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Entries Listing under parent character card */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-bold text-primary">已包含的专属知识词条 ({activeCharacter.lorebookEntries?.length || 0} 项)</span>
                  </div>

                  {activeCharacter.lorebookEntries?.map((entry) => (
                    <div key={entry.id} className="bg-card p-3.5 rounded-xl border border-border/80 text-xs">
                      <div className="flex items-center justify-between border-b border-border/60 pb-2 mb-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {entry.keys.map((k) => (
                            <span key={k} className="bg-primary/10 text-primary/80 px-1.5 py-0.5 rounded border border-primary/20 text-[10px]">
                              🔑 {k}
                            </span>
                          ))}
                          {entry.constant && <span className="bg-emerald-950/20 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-900/30 text-[9px]">常驻项</span>}
                        </div>
                        <div className="flex gap-1">
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
                      <p className="text-muted-foreground font-light leading-relaxed whitespace-pre-wrap">{entry.content}</p>
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
