const fs = require('fs');
const c = fs.readFileSync('src/utils/mvu_bundle.js', 'utf8');
const m = c.match(/https?:\/\/[^\s'"`]+(jsdelivr|github|google)[^\s'"`]*/gi);
if (m) {
  console.log('URLs count:', m.length);
  console.log('URLs:', [...new Set(m)].slice(0, 10));
} else {
  console.log('No matching URLs');
}
