const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const targetStr = `const appContextValue = {characters`;
const repStr = `const appContextValue = {editingSummaryId, setEditingSummaryId, characters`;
code = code.replace(targetStr, repStr);

fs.writeFileSync('src/App.tsx', code);
console.log('Patched appContextValue in App.tsx');

let finalFixCode = fs.readFileSync('scripts/final_fix.cjs', 'utf8');
const contextArrString = /, "setNewSummaryContent"\];/;
finalFixCode = finalFixCode.replace(/, "setNewSummaryContent", "activeLoreTab"/g, `, "setNewSummaryContent", "editingSummaryId", "setEditingSummaryId", "activeLoreTab"`);
fs.writeFileSync('scripts/final_fix.cjs', finalFixCode);

let contextReaddCode = fs.readFileSync('scripts/readd_context.cjs', 'utf8');
contextReaddCode = contextReaddCode.replace(/, "setNewSummaryContent", "activeLoreTab"/g, `, "setNewSummaryContent", "editingSummaryId", "setEditingSummaryId", "activeLoreTab"`);
fs.writeFileSync('scripts/readd_context.cjs', contextReaddCode);

let chatTabCode = fs.readFileSync('src/tabs/ChatTab.tsx', 'utf8');
chatTabCode = chatTabCode.replace(/newSummaryContent, setNewSummaryContent, activeLoreTab/g, `newSummaryContent, setNewSummaryContent, editingSummaryId, setEditingSummaryId, activeLoreTab`);
fs.writeFileSync('src/tabs/ChatTab.tsx', chatTabCode);

console.log('Patched context values');
