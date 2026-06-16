const fs = require('fs');
const readline = require('readline');
const path = require('path');

const logPath = 'C:\\Users\\20573\\.gemini\\antigravity-ide\\brain\\172983f2-d6e4-4f0f-8416-a95aa730e971\\.system_generated\\logs\\transcript.jsonl';

const rl = readline.createInterface({
  input: fs.createReadStream(logPath),
  crlfDelay: Infinity
});

rl.on('line', (line) => {
  if (line.toLowerCase().includes('logstore') || line.toLowerCase().includes('日志库')) {
    console.log(line);
  }
});
