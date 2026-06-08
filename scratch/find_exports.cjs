const fs = require('fs');
const content = fs.readFileSync('src/utils/mvu_bundle.js', 'utf8');
const regex = /export\s*\{[^}]*\}|export\s+default/g;
const matches = content.match(regex);
if (matches) {
  console.log('Export matches:', matches);
} else {
  console.log('No export matches');
}
