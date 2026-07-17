const fs = require('fs');
const { T } = require('./_gen_translations.cjs');

const content = fs.readFileSync('src/locales/translations.ts', 'utf8');
const NL = '\r\n';

// Extract zh-CN keys
const allLines = content.split('\n');
let insideZhCN = false;
const zhCNKeys = [];
for (const line of allLines) {
  if (line.includes('"zh-CN": {')) { insideZhCN = true; continue; }
  if (line.includes('"zh-TW": {')) { insideZhCN = false; continue; }
  if (insideZhCN) {
    const keyMatch = line.match(/^\s+"([^"]+)":/);
    if (keyMatch) zhCNKeys.push(keyMatch[1]);
  }
}
const zhCNSet = new Set(zhCNKeys);

// Find existing ja keys
let inJa = false;
const jaKeys = new Set();
for (const line of allLines) {
  if (line.includes('"ja": {')) { inJa = true; continue; }
  if (line.includes('"ru": {')) { inJa = false; continue; }
  if (inJa) {
    const keyMatch = line.match(/^\s+"([^"]+)":/);
    if (keyMatch) jaKeys.add(keyMatch[1]);
  }
}

const keysToAdd = Object.keys(T).filter(k => zhCNSet.has(k) && !jaKeys.has(k));

console.log('Keys to add:', keysToAdd.length);

function buildBlock(lang) {
  return keysToAdd.map(k => `    "${k}": ${JSON.stringify(T[k][lang])},`).join(NL);
}

// ja
let updated = content.replace(
  /(    "nav\.settings": "設定",)\r?\n(  \},\r?\n  "ru")/,
  (_, p1) => p1 + NL + NL + buildBlock('ja') + NL + '  },' + NL + '  "ru"'
);

// ru
updated = updated.replace(
  /(    "nav\.settings": "Настройки",)\r?\n(  \},\r?\n  "es")/,
  (_, p1) => p1 + NL + NL + buildBlock('ru') + NL + '  },' + NL + '  "es"'
);

// es
updated = updated.replace(
  /(    "nav\.settings": "Ajustes",)\r?\n(  \}\r?\n\};)/,
  (_, p1) => p1 + NL + NL + buildBlock('es') + NL + '  }' + NL + '};'
);

fs.writeFileSync('src/locales/translations.ts', updated, 'utf8');
console.log('Patched!');
