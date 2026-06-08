const fs = require('fs');
const mvuBundleContent = fs.readFileSync('src/utils/mvu_bundle.js', 'utf8');

const processedMvuBundle = mvuBundleContent
  .replace(
    /import\s*\{\s*klona\s+as\s+e\s*\}\s*from\s*['"]https:\/\/testingcf\.jsdelivr\.net\/npm\/klona\/\+esm['"]/g,
    "const e = window.parent.TavernHelperMvuLibs.klona;"
  )
  .replace(
    /import\s*\{\s*createPinia\s+as\s+t\s*,\s*defineStore\s+as\s+n\s*,\s*getActivePinia\s+as\s+a\s*,\s*setActivePinia\s+as\s+s\s*\}\s*from\s*['"]https:\/\/testingcf\.jsdelivr\.net\/npm\/pinia\/\+esm['"]/g,
    "const { createPinia: t, defineStore: n, getActivePinia: a, setActivePinia: s } = window.parent.TavernHelperMvuLibs;"
  )
  .replace(
    /import\s*\{\s*compare\s+as\s+r\s*\}\s*from\s*['"]https:\/\/testingcf\.jsdelivr\.net\/npm\/compare-versions\/\+esm['"]/g,
    "const r = window.parent.TavernHelperMvuLibs.compare;"
  )
  .replace(
    /import\s*\{\s*default\s+as\s+o\s*\}\s*from\s*['"]https:\/\/testingcf\.jsdelivr\.net\/npm\/json5\/\+esm['"]/g,
    "const o = window.parent.TavernHelperMvuLibs.JSON5;"
  )
  .replace(
    /import\s*\{\s*jsonrepair\s+as\s+i\s*\}\s*from\s*['"]https:\/\/testingcf\.jsdelivr\.net\/npm\/jsonrepair\/\+esm['"]/g,
    "const i = window.parent.TavernHelperMvuLibs.jsonrepair;"
  );

const regex = /import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"]|import\s*['"][^'"]+['"]/g;
const matches = processedMvuBundle.match(regex);
console.log('Matches remaining after process:', matches);
