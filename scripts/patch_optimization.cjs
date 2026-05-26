const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Add showFullHistory state
let stateHookOld = `  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showSessionManager, setShowSessionManager] = useState(false);`;
let stateHookNew = `  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showSessionManager, setShowSessionManager] = useState(false);
  const [showFullHistory, setShowFullHistory] = useState(false);
  
  useEffect(() => {
    setShowFullHistory(false);
  }, [activeSessionId]);`;
content = content.replace(stateHookOld, stateHookNew);

// 2. Add confirmation for deleting Character Lorebook Entry
let charLoreDeleteOld = `                          <button
                            onClick={() => {
                              const next = (editingChar.lorebookEntries || []).filter((e) => e.id !== entry.id);
                              setEditingChar({ ...editingChar, lorebookEntries: next });
                            }}
                            className="text-red-400"
                          >
                            擦除
                          </button>`;
let charLoreDeleteNew = `                          <button
                            onClick={async () => {
                              const ok = await showCustomConfirm("确定擦除该条世界书设定吗？");
                              if (ok) {
                                const next = (editingChar.lorebookEntries || []).filter((e) => e.id !== entry.id);
                                setEditingChar({ ...editingChar, lorebookEntries: next });
                              }
                            }}
                            className="text-red-400"
                          >
                            擦除
                          </button>`;
content = content.replace(charLoreDeleteOld, charLoreDeleteNew);

// 3. Fold history messages natively
let messagesMapOld = `                {/* Dialog Scroll area */}
                <div className="p-3.5 space-y-4 flex-1 overflow-y-auto custom-scrollbar">
                  {activeSession?.messages.map((message) => {
                    const isUser = message.sender === "user";`;

let messagesMapNew = `                {/* Dialog Scroll area */}
                <div className="p-3.5 space-y-4 flex-1 overflow-y-auto custom-scrollbar">
                  {(() => {
                    let messagesToRender = activeSession?.messages || [];
                    let foldedCount = 0;
                    if (!showFullHistory && messagesToRender.length > 0) {
                      let charCount = 0;
                      let foldIndex = 0;
                      for (let i = messagesToRender.length - 1; i >= 0; i--) {
                        charCount += messagesToRender[i].content.length;
                        if (charCount > 10000 && messagesToRender.length - i >= 4) {
                          foldIndex = i;
                          break;
                        }
                      }
                      if (foldIndex > 0) {
                        foldedCount = foldIndex;
                        messagesToRender = messagesToRender.slice(foldIndex);
                      }
                    }

                    return (
                      <>
                        {foldedCount > 0 && (
                          <div className="flex justify-center mb-2 animate-fadeIn">
                             <button onClick={() => setShowFullHistory(true)} className="bg-muted hover:bg-muted/80 border border-border text-[10px] px-4 py-1.5 rounded-full text-muted-foreground shadow-sm flex items-center gap-1.5 transition">
                               <ChevronUp className="w-3 h-3" /> 点击展开更早的 {foldedCount} 条历史对话 (节约内存渲染)
                             </button>
                          </div>
                        )}
                        {messagesToRender.map((message) => {
                          const isUser = message.sender === "user";`;
content = content.replace(messagesMapOld, messagesMapNew);

// Match the bottom of the map map
let messagesMapBottomOld = `                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>`;
let messagesMapBottomNew = `                          </div>
                        </div>
                      </div>
                    );
                  })}
                      </>
                    );
                  })()}
                </div>`;
content = content.replace(messagesMapBottomOld, messagesMapBottomNew);

// Match icons to add ChevronUp
let chevronUpOld = `import { Settings, PlaySettings, Book, MessageSquare, Plus, PenSquare, ArrowLeft, ArrowRight, Save, Trash2, Send, Download, Upload, AlertCircle, Eye, EyeOff, Bot, Check, Info, Command, Edit2, PlayCircle, Hash, MessageCircle, Lock, Database, RefreshCw, Layers, Zap, Cpu } from "lucide-react";`;
let chevronUpNew = `import { Settings, PlaySettings, Book, MessageSquare, Plus, PenSquare, ArrowLeft, ArrowRight, ChevronUp, Save, Trash2, Send, Download, Upload, AlertCircle, Eye, EyeOff, Bot, Check, Info, Command, Edit2, PlayCircle, Hash, MessageCircle, Lock, Database, RefreshCw, Layers, Zap, Cpu } from "lucide-react";`;
content = content.replace(chevronUpOld, chevronUpNew); // In case it wasn't there

fs.writeFileSync('src/App.tsx', content);
