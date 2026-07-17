const fs = require('fs');
const c = fs.readFileSync('src/locales/translations.ts', 'utf8').replace(/\r\n/g, '\n');
const idx1 = c.lastIndexOf('  },\n\n  "ko"');
const idx2 = c.lastIndexOf('  }\n};');
console.log('es+ko transition:');
console.log(c.substring(idx1, idx2 + 7));
console.log('\n\nFile ending (last 50 chars):');
console.log(c.slice(-50));
