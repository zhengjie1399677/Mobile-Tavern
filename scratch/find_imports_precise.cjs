const fs = require('fs');
const content = fs.readFileSync('src/utils/mvu_bundle.js', 'utf8');
const lines = content.split('\n');
lines.forEach((line, index) => {
  const trimmed = line.trim();
  if (trimmed.startsWith('import ') || trimmed.startsWith('import{') || trimmed.startsWith('import*') || trimmed.includes(' from \'https') || trimmed.includes(' from "https')) {
    console.log(`Line ${index + 1}: ${trimmed}`);
  }
});
