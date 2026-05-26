const fs = require('fs');
let code = fs.readFileSync('src/tabs/ChatTab.tsx', 'utf8');

const target = `await handleAutoSummaryCheck(activeSession);`;
const replacement = `await handleAutoSummaryCheck(activeSession, true);`;

code = code.replace(target, replacement);

fs.writeFileSync('src/tabs/ChatTab.tsx', code);
console.log("Patched ChatTab.tsx Auto Summary button");
