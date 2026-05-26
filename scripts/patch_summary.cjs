const fs = require('fs');

let content = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Update the term "词元" -> "Token" in the UI
content = content.replace(/{message\.tokenCount} 词元/g, '{message.tokenCount} Token');

// 2. Change the range slider for summaryTriggerTurns to allow 0 (and label it appropriately if 0)
let uiOld = `<div className="flex justify-between"><span className="font-semibold">动态压缩触底延迟 (Summary Wait)</span><span className="font-mono">{settings.memory.summaryTriggerTurns}</span></div>
                           <input
                             type="range" min="8" max="25" step="1"`;
let uiNew = `<div className="flex justify-between">
                             <span className="font-semibold">自动整理间隔轮次 (Auto Summary)</span>
                             <span className="font-mono">{settings.memory.summaryTriggerTurns === 0 ? "跟随正文设定 (0)" : settings.memory.summaryTriggerTurns}</span>
                           </div>
                           <input
                             type="range" min="0" max="25" step="1"`;
content = content.replace(uiOld, uiNew);

// 3. Fix the auto summary logic
let autoSummaryOld = `  const handleAutoSummaryCheck = async (session: ChatSession) => {
    const { summaryTriggerTurns, summaryLength } = settings.memory;
    // Compress earlier turns if message count exceeds summary trigger
    if (session.messages.length > summaryTriggerTurns) {
      const messagesToCompress = session.messages.slice(0, session.messages.length - 6);
      const isSystemAlreadySummarized = session.summaries.length > 0;`;

let autoSummaryNew = `  const handleAutoSummaryCheck = async (session: ChatSession) => {
    const { recentTurns, summaryTriggerTurns, summaryLength } = settings.memory;
    const interval = summaryTriggerTurns === 0 ? recentTurns : summaryTriggerTurns;
    const maxAllowedMessages = recentTurns + interval;

    // Compress earlier turns if message count exceeds allowed accumulation
    if (session.messages.length >= maxAllowedMessages) {
      const messagesToCompress = session.messages.slice(0, session.messages.length - recentTurns);
      const isSystemAlreadySummarized = session.summaries.length > 0;`;

content = content.replace(autoSummaryOld, autoSummaryNew);

// 4. Fix slicing in auto summary logic
let sliceOld = `// Retain only last 6 messages
          const trimmedHistory = session.messages.slice(-6);`;
let sliceNew = `// Retain only last recentTurns messages
          const trimmedHistory = session.messages.slice(-recentTurns);`;
content = content.replace(sliceOld, sliceNew);

// 5. Change default summaryTriggerTurns to 0
let defaultOld = `memory: { recentTurns: 6, midTermTurns: 4, summaryTriggerTurns: 12, summaryLength: 120, useMidTerm: true }`;
let defaultNew = `memory: { recentTurns: 6, midTermTurns: 4, summaryTriggerTurns: 0, summaryLength: 120, useMidTerm: true }`;
content = content.replace(defaultOld, defaultNew);


fs.writeFileSync('src/App.tsx', content);
