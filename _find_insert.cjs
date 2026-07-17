const fs = require('fs');

const enKeys = JSON.parse(fs.readFileSync('_en_keys.json', 'utf8'));
// Read original and find insert position
const orig = fs.readFileSync('src/locales/translations.ts', 'utf8');

// Find "es" section end - the last "  }\n" before final "};\n"
const esSectionMatch = orig.match(/(  }\n)(\s*\}\s*;\s*)$/);
console.log('Match:', !!esSectionMatch);
if (esSectionMatch) {
  const before = orig.substring(0, orig.length - esSectionMatch[0].length + esSectionMatch[1].length);
  fs.writeFileSync('_translations_prefix.txt', before, 'utf8');
  console.log('Prefix length:', before.length);
} else {
  console.log('No match found');
  console.log('Last 50 chars:', JSON.stringify(orig.substring(orig.length - 100)));
}
