const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');
code = code.replace(/<CharactersTab \/>\}\}/g, '<CharactersTab />');
code = code.replace(/<ChatHistoryTab \/>\}\}/g, '<ChatHistoryTab />');
code = code.replace(/<ChatTab \/>\}\}/g, '<ChatTab />');
code = code.replace(/<GlobalWorldbookTab \/>\}\}/g, '<GlobalWorldbookTab />');
code = code.replace(/<SettingsTab \/>\}\}/g, '<SettingsTab />');
fs.writeFileSync('src/App.tsx', code);
