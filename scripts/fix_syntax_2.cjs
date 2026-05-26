const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');
code = code.replace(/{activeTab === "characters" && <CharactersTab \/>/g, '{activeTab === "characters" && <CharactersTab />}');
code = code.replace(/{activeTab === "chat-history" && <ChatHistoryTab \/>/g, '{activeTab === "chat-history" && <ChatHistoryTab />}');
code = code.replace(/{activeTab === "chat" && <ChatTab \/>/g, '{activeTab === "chat" && <ChatTab />}');
code = code.replace(/{activeTab === "global-worldbook" && <GlobalWorldbookTab \/>/g, '{activeTab === "global-worldbook" && <GlobalWorldbookTab />}');
code = code.replace(/{activeTab === "settings" && <SettingsTab \/>/g, '{activeTab === "settings" && <SettingsTab />}');
fs.writeFileSync('src/App.tsx', code);
