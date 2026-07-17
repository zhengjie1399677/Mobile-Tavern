const fs = require('fs');
const content = fs.readFileSync('src/locales/translations.ts', 'utf8');

// Extract en section - find from '"en": {' to the next major language key
const enStart = content.indexOf('\n  "en": {');
console.log('enStart:', enStart);
const afterEn = content.indexOf('\n  "ja": {', enStart + 10);
console.log('afterEn:', afterEn);
const enSection = content.substring(enStart + 1, afterEn);
console.log('Section length:', enSection.length);

// Parse keys
const lines = enSection.split('\n');
const keys = [];
for (const line of lines) {
  const m = line.match(/^\s+"([^"]+)":\s+"(.*)",?\s*$/);
  if (m) {
    keys.push({ key: m[1], value: m[2] });
  }
}
console.log('Total keys:', keys.length);
console.log('First value:', keys[0].value);
console.log('Last value:', keys[keys.length-1].value);
fs.writeFileSync('_en_keys.json', JSON.stringify(keys, null, 2), 'utf8');
console.log('Done');
