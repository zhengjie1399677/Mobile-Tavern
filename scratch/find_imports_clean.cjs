const fs = require('fs');
const c = fs.readFileSync('src/utils/mvu_bundle.js', 'utf8');
const m = c.match(/import\s*[\s\S]*?from\s*['"][^'"]+['"]|import\s*['"][^'"]+['"]/g);
if (m) {
  m.forEach((imp, i) => console.log(`${i}: ${imp}`));
} else {
  console.log('No static imports');
}
