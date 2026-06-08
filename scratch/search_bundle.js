const fs = require('fs');
const path = require('path');

function searchFile(filePath, query) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    console.log(`File: ${filePath}, Size: ${content.length} chars`);
    
    // Check if it's UTF-16
    if (content.includes('\u0000')) {
      const utf16Content = fs.readFileSync(filePath, 'utf16le');
      console.log(`File: ${filePath} is UTF-16LE, Size: ${utf16Content.length} chars`);
      findQuery(utf16Content, query);
    } else {
      findQuery(content, query);
    }
  } catch (e) {
    console.error(`Error reading ${filePath}:`, e);
  }
}

function findQuery(text, query) {
  const regex = new RegExp(query, 'gi');
  let match;
  let count = 0;
  while ((match = regex.exec(text)) && count < 10) {
    count++;
    const start = Math.max(0, match.index - 50);
    const end = Math.min(text.length, match.index + 50);
    console.log(`Match ${count}: ...${text.slice(start, end).replace(/\n/g, ' ')}...`);
  }
  console.log(`Total matches for "${query}": ${count === 10 ? '10+' : count}`);
}

const dir = 'C:/Users/20573/Desktop/角色卡';
const files = fs.readdirSync(dir);
console.log('Files in directory:', files);

for (const file of files) {
  if (file.endsWith('.js') || file.endsWith('.json')) {
    searchFile(path.join(dir, file), 'instanceof');
    searchFile(path.join(dir, file), 'mvu');
    searchFile(path.join(dir, file), '\\.z\\.');
  }
}
