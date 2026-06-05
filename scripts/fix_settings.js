import fs from 'fs';

let text = fs.readFileSync('src/tabs/SettingsTab.tsx', 'utf8');

text = text.replace('{settings.api.type === "openai-proxy" && (', '');
// I need to remove `{settings.api.type === "openai-proxy" && (` and its matching closing `)}` around line 283.
// And `settings.api.type === "gemini-builtin" ? "不填则使用服务器默认Key" : "sk-..."` to `"sk-..."`
// And `settings.api.type === "gemini-builtin" ? "..." : "..."` strings

