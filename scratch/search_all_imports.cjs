const fs = require('fs');
const content = fs.readFileSync('src/utils/mvu_bundle.js', 'utf8');

let pos = 0;
while (true) {
  const index = content.indexOf('import', pos);
  if (index === -1) break;
  
  const start = Math.max(0, index - 50);
  const end = Math.min(content.length, index + 150);
  console.log(`Index ${index}: ... ${content.substring(start, end).replace(/\n/g, ' ')} ...`);
  pos = index + 6;
}
