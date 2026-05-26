const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// 1. activeTab type
let activeTabOld = `const [activeTab, setActiveTab] = useState<"characters" | "chat" | "settings" | "global-worldbook">("characters");`;
let activeTabNew = `const [activeTab, setActiveTab] = useState<"characters" | "chat" | "chat-history" | "settings" | "global-worldbook">("characters");`;
content = content.replace(activeTabOld, activeTabNew);

// 2. Chat tab to chat history
let navOld = `<button
          onClick={async () => {
            if (activeCharId) {
              setActiveTab("chat");
              triggerScroll();
            } else {
              await showCustomAlert("请先前往 [角色馆] 选择一个AI角色伙伴。");
            }
          }}
          className={\`flex flex-col items-center justify-center flex-1 h-full transition-all \${
            activeTab === "chat" ? "text-primary scale-105" : "text-muted-foreground hover:text-muted-foreground"
          }\`}
        >
          <MessageSquare className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] font-medium">对话流</span>
        </button>`;
let navNew = `<button
          onClick={() => setActiveTab("chat-history")}
          className={\`flex flex-col items-center justify-center flex-1 h-full transition-all \${
            (activeTab === "chat-history" || activeTab === "chat") ? "text-primary scale-105" : "text-muted-foreground hover:text-muted-foreground"
          }\`}
        >
          <MessageSquare className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] font-medium">历史对话</span>
        </button>`;
content = content.replace(navOld, navNew);

// 3. Insert Chat History List
let historyContent = `        {/* === SECTION B.1: CHAT HISTORY (All Sessions) === */}
        {activeTab === "chat-history" && (
          <div className="p-4 space-y-4 pb-20">
            <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-1.5 pb-2 border-b border-border">
              历史对话 (History)
            </h1>
            {sessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-10 text-center text-muted-foreground">
                <MessageSquare className="w-10 h-10 mb-2 opacity-50" />
                <p className="text-sm">暂无任何对话记录</p>
                <p className="text-[11px] mt-1">去角色馆选择一个角色开始聊天吧！</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {sessions.sort((a,b) => b.createdAt - a.createdAt).map(s => {
                  const char = characters.find(c => c.id === s.characterId);
                  return (
                    <div 
                      key={s.id} 
                      className="bg-card border border-border rounded-xl p-3 flex items-center gap-3 cursor-pointer hover:border-primary/50 transition shadow-sm"
                      onClick={() => {
                        setActiveCharId(s.characterId);
                        setActiveSessionId(s.id);
                        setActiveTab("chat");
                        setChatSubTab("dialogue");
                        triggerScroll();
                      }}
                    >
                      <div className="w-10 h-10 rounded-full overflow-hidden bg-muted border border-border/80 shrink-0">
                        {char?.avatar ? <img src={char.avatar} alt="avatar" className="w-full h-full object-cover" /> : <span className="flex items-center justify-center h-full text-sm font-bold text-primary">{char?.name?.[0] || "?"}</span>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex justify-between items-start">
                          <h4 className="font-bold text-sm truncate text-foreground">{s.title || "主剧情线"}</h4>
                          <span className="text-[9px] text-muted-foreground whitespace-nowrap pt-0.5">{new Date(s.createdAt).toLocaleDateString()}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate opacity-70">{char?.name || "未知角色"} | {s.messages.length} 回合对话</p>
                      </div>
                      <button 
                        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive p-2 rounded shrink-0 transition"
                        title="删除对话"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteBranch(s.id);
                        }}
                      >
                         <Trash2 className="w-4 h-4"/>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* === SECTION B: THE ACTIVE CHAT ROOM === */}`;

let sectionBOld = `{/* === SECTION B: THE ACTIVE CHAT ROOM === */}`;
content = content.replace(sectionBOld, historyContent);

// 4. Update the chat header back button
let headerBackOld = `<button onClick={() => setActiveTab("characters")} className="text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="w-5 h-5" />
                </button>`;
let headerBackNew = `<button onClick={() => setActiveTab("chat-history")} className="text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="w-5 h-5" />
                </button>`;
content = content.replace(headerBackOld, headerBackNew);

// 5. Update Memory UI for summary Trigger
let autoSummaryUIOld = `<div className="flex items-center justify-between mt-4">
                          <div className="flex flex-col">
                            <span className="font-semibold text-foreground text-[13px]">记忆整理阈值 (Auto Summary)</span>
                            <span className="text-[10px] text-muted-foreground">每隔多少轮总结之前对话 (0则跟随上一项)</span>
                          </div>
                          <input
                            type="number" min="0" max="100" step="1"
                            value={settings.memory.summaryTriggerTurns}
                            onChange={(e) => updateSettings({ ...settings, memory: { ...settings.memory, summaryTriggerTurns: parseInt(e.target.value) || 0 } })}
                            className="w-16 bg-muted border border-border text-center rounded p-1 text-sm outline-none focus:border-primary"
                          />
                        </div>`;

let autoSummaryUINew = `<div className="space-y-3 mt-4 pt-4 border-t border-border/50">
                          <div className="flex items-center justify-between">
                            <div className="flex flex-col">
                              <span className="font-semibold text-foreground text-[13px] flex items-center gap-2">自动记忆整理 (Auto Summary) <Switch checked={settings.memory.summaryTriggerTurns !== 0} onCheckedChange={(val) => updateSettings({ ...settings, memory: { ...settings.memory, summaryTriggerTurns: val ? 10 : 0 } })} className="data-[state=checked]:bg-primary h-4 w-8 [&_span]:h-3 [&_span]:w-3"/></span>
                              <span className="text-[10px] text-muted-foreground mt-0.5">定期梳理记忆，否则默认与上方发送轮数同步整理</span>
                            </div>
                          </div>
                          {settings.memory.summaryTriggerTurns !== 0 && (
                            <div className="flex justify-between items-center bg-muted/30 p-2 rounded border border-border">
                               <span className="text-[11px] text-muted-foreground font-semibold">触发轮次 (满多少轮执行一次梳理)</span>
                               <input
                                  type="number" min="2" max="100" step="1"
                                  value={settings.memory.summaryTriggerTurns}
                                  onChange={(e) => updateSettings({ ...settings, memory: { ...settings.memory, summaryTriggerTurns: parseInt(e.target.value) || 2 } })}
                                  className="w-16 bg-muted border border-border text-center rounded p-1 text-sm outline-none focus:border-primary"
                                />
                            </div>
                          )}
                        </div>`;
content = content.replace(autoSummaryUIOld, autoSummaryUINew);


fs.writeFileSync('src/App.tsx', content);
