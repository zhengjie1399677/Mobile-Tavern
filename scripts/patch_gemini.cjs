const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');
content = content.replace(/modelName: settings\.api\.modelName \|\| "gemini-3\.5-flash"/g, 'modelName: settings.api.modelName || "gemini-3.5-flash",\n            apiKey: settings.api.apiKey');
content = content.replace(/modelName: "gemini-3\.5-flash"(\n\s*\}\))/g, 'modelName: "gemini-3.5-flash",\n              apiKey: settings.api.apiKey$1');

fs.writeFileSync('src/App.tsx', content);
