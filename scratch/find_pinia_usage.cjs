const fs = require('fs');
const content = fs.readFileSync('src/utils/mvu_bundle.js', 'utf8');

function findUsage(name) {
  const regex = new RegExp(`[^a-zA-Z0-9_${name}]${name}[^a-zA-Z0-9_]`, 'g');
  const matches = [];
  let match;
  while ((match = regex.exec(content))) {
    const start = Math.max(0, match.index - 50);
    const end = Math.min(content.length, match.index + 50);
    matches.push(`... ${content.slice(start, end).replace(/\n/g, ' ')} ...`);
    if (matches.length >= 5) break;
  }
  console.log(`Usage of ${name}:`, matches);
}

findUsage('createPinia');
findUsage('defineStore');
findUsage('getActivePinia');
findUsage('setActivePinia');
