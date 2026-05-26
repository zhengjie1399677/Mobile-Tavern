const fs = require('fs');

let content = fs.readFileSync('src/App.tsx', 'utf8');

let autoSummaryOld = `  const handleAutoSummaryCheck = async (session: ChatSession) => {
    const { recentTurns, summaryTriggerTurns, summaryLength } = settings.memory;
    const interval = summaryTriggerTurns === 0 ? recentTurns : summaryTriggerTurns;
    const maxAllowedMessages = recentTurns + interval;

    // Compress earlier turns if message count exceeds allowed accumulation
    if (session.messages.length >= maxAllowedMessages) {
      const messagesToCompress = session.messages.slice(0, session.messages.length - recentTurns);
      const isSystemAlreadySummarized = session.summaries.length > 0;`;

let autoSummaryNew = `  const handleAutoSummaryCheck = async (session: ChatSession) => {
    const { recentTurns, summaryTriggerTurns, summaryLength, useMidTerm, midTermTurns } = settings.memory;
    const interval = summaryTriggerTurns === 0 ? recentTurns : summaryTriggerTurns;
    const messagesToKeep = recentTurns + (useMidTerm ? midTermTurns : 0);
    const maxAllowedMessages = messagesToKeep + interval;

    // Compress earlier turns if message count exceeds allowed accumulation
    if (session.messages.length >= maxAllowedMessages) {
      const messagesToCompress = session.messages.slice(0, session.messages.length - messagesToKeep);
      const isSystemAlreadySummarized = session.summaries.length > 0;`;

content = content.replace(autoSummaryOld, autoSummaryNew);

let sliceOld = `// Retain only last recentTurns messages
          const trimmedHistory = session.messages.slice(-recentTurns);`;
let sliceNew = `// Retain only last messagesToKeep messages
          const trimmedHistory = session.messages.slice(-messagesToKeep);`;
content = content.replace(sliceOld, sliceNew);

fs.writeFileSync('src/App.tsx', content);
