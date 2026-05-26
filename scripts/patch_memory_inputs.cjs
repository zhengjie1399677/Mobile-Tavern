const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

let oldMemoryUI = `<div className={\`space-y-4 pt-1 transition-opacity \${!settings.memory.useMidTerm ? 'opacity-40 pointer-events-none' : ''}\`}>
                        <div className="space-y-2">
                           <div className="flex justify-between"><span className="font-semibold">中期存续保留期 (Mid-Term Buffer Size)</span><span className="font-mono">{settings.memory.midTermTurns}</span></div>
                           <input
                             type="range" min="0" max="15" step="1"
                             value={settings.memory.midTermTurns}
                             onChange={(e) => updateSettings({ ...settings, memory: { ...settings.memory, midTermTurns: parseInt(e.target.value) } })}
                             className="w-full accent-primary h-1 bg-border rounded-lg appearance-none cursor-pointer"
                           />
                        </div>
                        <div className="space-y-2">
                           <div className="flex justify-between">
                             <span className="font-semibold">自动整理间隔轮次 (Auto Summary)</span>
                             <span className="font-mono">{settings.memory.summaryTriggerTurns === 0 ? "跟随正文设定 (0)" : settings.memory.summaryTriggerTurns}</span>
                           </div>
                           <input
                             type="range" min="0" max="25" step="1"
                             value={settings.memory.summaryTriggerTurns}
                             onChange={(e) => updateSettings({ ...settings, memory: { ...settings.memory, summaryTriggerTurns: parseInt(e.target.value) } })}
                             className="w-full accent-primary h-1 bg-border rounded-lg appearance-none cursor-pointer"
                           />
                        </div>
                      </div>`;

content = content.replace(oldMemoryUI, "");

let oldSlider = `<div className="space-y-2">
                        <div className="flex justify-between"><span className="font-semibold text-foreground">深记轮次限制 (Recent Turns)</span><span className="font-mono">{settings.memory.recentTurns}</span></div>
                        <input
                          type="range" min="2" max="15" step="1"
                          value={settings.memory.recentTurns}
                          onChange={(e) => updateSettings({ ...settings, memory: { ...settings.memory, recentTurns: parseInt(e.target.value) } })}
                          className="w-full accent-primary h-1 bg-border rounded-lg appearance-none cursor-pointer"
                        />
                      </div>
                      
                      <div className="flex items-center justify-between border-t border-border/50 pt-4">
                        <div className="font-semibold text-foreground flex items-center gap-2">
                          <Switch checked={settings.memory.useMidTerm} onCheckedChange={(val) => updateSettings({ ...settings, memory: { ...settings.memory, useMidTerm: val } })} className="data-[state=checked]:bg-primary" />
                          <span>中期缓冲池压缩技术</span>
                        </div>
                      </div>`;

let newSliders = `<div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex flex-col">
                            <span className="font-semibold text-foreground text-[13px]">上下文发送轮次 (Recent Turns)</span>
                            <span className="text-[10px] text-muted-foreground">直接发送全文保留的对话局数</span>
                          </div>
                          <input
                            type="number" min="2" max="100" step="1"
                            value={settings.memory.recentTurns}
                            onChange={(e) => updateSettings({ ...settings, memory: { ...settings.memory, recentTurns: parseInt(e.target.value) || 0 } })}
                            className="w-16 bg-muted border border-border text-center rounded p-1 text-sm outline-none focus:border-primary"
                          />
                        </div>
                        
                        <div className="flex items-center justify-between mt-4">
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
                        </div>
                      </div>`;
content = content.replace(oldSlider, newSliders);

let autoSummaryOld = `  const handleAutoSummaryCheck = async (session: ChatSession) => {
    const { recentTurns, summaryTriggerTurns, summaryLength, useMidTerm, midTermTurns } = settings.memory;
    const interval = summaryTriggerTurns === 0 ? recentTurns : summaryTriggerTurns;
    const messagesToKeep = recentTurns + (useMidTerm ? midTermTurns : 0);
    const maxAllowedMessages = messagesToKeep + interval;

    // Compress earlier turns if message count exceeds allowed accumulation
    if (session.messages.length >= maxAllowedMessages) {
      const messagesToCompress = session.messages.slice(0, session.messages.length - messagesToKeep);`;

let autoSummaryNew = `  const handleAutoSummaryCheck = async (session: ChatSession) => {
    const { recentTurns, summaryTriggerTurns, summaryLength } = settings.memory;
    const interval = summaryTriggerTurns === 0 ? recentTurns : summaryTriggerTurns;
    const maxAllowedMessages = recentTurns + interval;

    // Compress earlier turns if message count exceeds allowed accumulation
    if (session.messages.length >= maxAllowedMessages) {
      const messagesToCompress = session.messages.slice(0, session.messages.length - recentTurns);`;
content = content.replace(autoSummaryOld, autoSummaryNew);

let sliceOld = `// Retain only last messagesToKeep messages
          const trimmedHistory = session.messages.slice(-messagesToKeep);`;
let sliceNew = `// Retain only last recentTurns messages
          const trimmedHistory = session.messages.slice(-recentTurns);`;
content = content.replace(sliceOld, sliceNew);

let estimatorOld = `(activeSession?.messages.slice(-(settings.memory.recentTurns + (settings.memory.useMidTerm ? settings.memory.midTermTurns : 0))).reduce`;
let estimatorNew = `(activeSession?.messages.slice(-(settings.memory.recentTurns)).reduce`;
content = content.replace(estimatorOld, estimatorNew);

fs.writeFileSync('src/App.tsx', content);
