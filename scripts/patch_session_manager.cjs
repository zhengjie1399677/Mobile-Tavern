const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Add states
let stateOld = `  const [activeCharId, setActiveCharId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);`;
let stateNew = `  const [activeCharId, setActiveCharId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showSessionManager, setShowSessionManager] = useState(false);`;
content = content.replace(stateOld, stateNew);

// 2. Add functions
let funcOld = `  // Switch to specific character & select or create session
  const selectCharacter = async (charId: string) => {`;
let funcNew = `  // Branch Management
  const createNewBranch = async () => {
    if (!activeCharId) return;
    const branchTitle = await showCustomPrompt("请输入全新独立分支存档名称:", \`\${activeCharacter?.name} - 新分支线 \${new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}\`);
    if (!branchTitle) return;

    const newSession: ChatSession = {
      id: "session_branch_" + Math.random().toString(36).substring(2, 9),
      characterId: activeCharId,
      title: branchTitle,
      messages: [],
      summaries: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    setSessions((prev) => [...prev, newSession]);
    await saveSession(newSession);
    setActiveSessionId(newSession.id);
    setShowSessionManager(false);
  };

  const deleteBranch = async (id: string) => {
    const confirm = await showCustomConfirm("确定要永久删除这个聊天分支吗？(无法恢复)");
    if (!confirm) return;
    
    await deleteSession(id);
    setSessions((prev) => {
      const remaining = prev.filter(s => s.id !== id);
      if (activeSessionId === id) {
        const charRemaining = remaining.filter(s => s.characterId === activeCharId).sort((a,b) => b.createdAt - a.createdAt);
        if (charRemaining.length > 0) {
          setActiveSessionId(charRemaining[0].id);
        } else {
          setActiveSessionId(null);
        }
      }
      return remaining;
    });
  };

  // Switch to specific character & select or create session
  const selectCharacter = async (charId: string) => {`;
content = content.replace(funcOld, funcNew);

// 3. Inject Button in Header
let headerOld = `                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-foreground truncate leading-tight">{activeCharacter?.name}</h2>
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5 font-light" onClick={async () => {
                    const nextTitle = await showCustomPrompt("修改当前分支线标题已在IndexedDB进行分支区分:", activeSession?.title || "");`;
let headerNew = `                <div className="min-w-0 flex flex-col">
                  <div className="flex items-center gap-1.5">
                    <h2 className="text-sm font-bold text-foreground truncate leading-tight">{activeCharacter?.name}</h2>
                    <button onClick={() => setShowSessionManager(true)} className="text-primary hover:bg-primary/10 p-0.5 rounded transition" title="分支管理">
                      <GitFork className="w-3 h-3" />
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5 font-light cursor-pointer" onClick={async () => {
                    const nextTitle = await showCustomPrompt("修改当前分支线标题已在IndexedDB进行分支区分:", activeSession?.title || "");`;
content = content.replace(headerOld, headerNew);


// 4. Inject Modal at the bottom
let overlayOld = `{/* Embedded Non-blocking Dialog for Alert & Confirm & Prompt notifications */}`;
let overlayNew = `{/* Branch Manager Modal */}
      {showSessionManager && activeCharacter && (
        <div 
          className="absolute inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 transition-all duration-200" 
          style={{ zIndex: 100 }}
        >
          <div className="bg-card border border-border rounded-xl max-w-sm w-full p-5 shadow-2xl text-foreground flex flex-col h-[60vh] max-h-[500px]">
             <div className="flex justify-between items-center mb-4 shrink-0">
               <h3 className="font-bold text-lg flex items-center gap-2"><GitFork className="w-5 h-5 text-primary"/> 对话分支管理</h3>
               <button onClick={() => setShowSessionManager(false)} className="text-muted-foreground hover:text-foreground">
                 <X className="w-5 h-5"/>
               </button>
             </div>
             <div className="flex-1 overflow-y-auto space-y-2 pb-4 pr-1 custom-scrollbar">
                {sessions.filter(s => s.characterId === activeCharacter.id).sort((a,b) => b.createdAt - a.createdAt).map(s => (
                  <div key={s.id} className={\`p-3 border rounded-lg flex flex-col gap-2 transition-colors cursor-pointer \${s.id === activeSession?.id ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary/50'}\`} onClick={() => { setActiveSessionId(s.id); setShowSessionManager(false); }}>
                    <div className="flex justify-between items-start">
                      <div className="min-w-0 pr-2 pb-1">
                        <h4 className="font-bold text-sm truncate">{s.title || "主剧情线"}</h4>
                        <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">{new Date(s.createdAt).toLocaleString()} | {s.messages.length} 回合 | {s.summaries.length} 片段</p>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); deleteBranch(s.id); }} className="text-destructive p-1.5 rounded hover:bg-destructive/10 shrink-0 transition" title="删除该分支">
                        <Trash2 className="w-4 h-4"/>
                      </button>
                    </div>
                  </div>
                ))}
             </div>
             <button onClick={createNewBranch} className="shrink-0 w-full bg-primary text-primary-foreground py-2.5 rounded-lg text-sm font-semibold hover:opacity-90 flex justify-center items-center gap-2 mt-2">
                <Plus className="w-4 h-4" /> 新建空白分支
             </button>
          </div>
        </div>
      )}

      {/* Embedded Non-blocking Dialog for Alert & Confirm & Prompt notifications */}`;
content = content.replace(overlayOld, overlayNew);

fs.writeFileSync('src/App.tsx', content);
