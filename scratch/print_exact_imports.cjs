const fs = require('fs');
const content = fs.readFileSync('src/utils/mvu_bundle.js', 'utf8');
const regex = /import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"]|import\s*['"][^'"]+['"]/g;
const matches = content.match(regex);
if (matches) {
  console.log('Matches length:', matches.length);
  matches.forEach((m, i) => console.log(`${i}: ${m}`));
} else {
  console.log('No matches');
}
