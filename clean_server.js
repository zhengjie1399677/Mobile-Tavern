import fs from 'fs';

let text = fs.readFileSync('server.ts', 'utf8');

// remove import
text = text.replace('import { GoogleGenAI } from "@google/genai";\n', '');

// remove geminiClient
const clientStart = text.indexOf('// Initialize Gemini client lazily');
const clientEnd = text.indexOf('async function startServer()');
if (clientStart !== -1 && clientEnd !== -1) {
    text = text.substring(0, clientStart) + text.substring(clientEnd);
}

// remove /api/gemini/chat
const apiStart = text.indexOf('// API 1: Out-of-the-box Gemini Chat proxy');
const apiEnd = text.indexOf('// API 2: Test connection for API config');
if (apiStart !== -1 && apiEnd !== -1) {
    text = text.substring(0, apiStart) + text.substring(apiEnd);
}

fs.writeFileSync('server.ts', text);
console.log('done!');
