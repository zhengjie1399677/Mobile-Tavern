const fs = require('fs');
const logPath = 'C:\\Users\\20573\\.gemini\\antigravity-ide\\brain\\172983f2-d6e4-4f0f-8416-a95aa730e971\\.system_generated\\logs\\transcript.jsonl';

const content = fs.readFileSync(logPath, 'utf8');
console.log("Transcript length:", content.length);
const matches = content.match(/"SlsLogstore":\s*"([^"]+)"/g);
console.log("SlsLogstore matches in json:", matches);

const lines = content.split('\n');
for (const line of lines) {
  if (line.includes('fc_handler.py')) {
    console.log("Line with fc_handler.py:", line.substring(0, 300));
  }
}
