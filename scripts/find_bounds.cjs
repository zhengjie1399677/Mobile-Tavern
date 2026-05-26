const fs = require('fs');
const content = fs.readFileSync('src/App.tsx', 'utf8');

const t1 = content.indexOf('{activeTab === "characters" && (');
const t2 = content.indexOf('{activeTab === "chat-history" && (');
const t3 = content.indexOf('{activeTab === "chat" && (');
const t4 = content.indexOf('{activeTab === "global-worldbook" && (');
const t5 = content.indexOf('{activeTab === "settings" && (');

console.log('characters:', t1);
console.log('chat-history:', t2);
console.log('chat:', t3);
console.log('global-worldbook:', t4);
console.log('settings:', t5);
