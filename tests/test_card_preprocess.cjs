const fs = require('fs');

function preprocessScriptContent(content) {
  let processed = content;

  // 1. Replace the MVU bundle import
  processed = processed.replace(
    /import\s*['"][^'"]*bundle(?:\.js)?['"];?/g,
    `// Local MVU bundle pre-loaded`
  );

  // 2. Replace the MVU zod import
  processed = processed.replace(
    /import\s*\{[^}]*registerMvuSchema[^}]*\}\s*from\s*['"][^'"]*mvu_zod(?:\.js)?['"];?/g,
    `const registerMvuSchema = window.registerMvuSchema;`
  );

  // 3. Generic replacement for jsdelivr npm packages ESM imports
  processed = processed.replace(
    /import\s*\{([^}]+)\}\s*from\s*['"]https?:\/\/(?:testingcf\.)?jsdelivr\.net\/npm\/([^/]+)\/\+esm['"]/g,
    (match, importsStr, pkgName) => {
      const parts = importsStr.split(',').map((p) => {
        const item = p.trim();
        if (item.includes(' as ')) {
          const [orig, alias] = item.split(/\s+as\s+/);
          if (pkgName === 'json5' && orig === 'default') {
            return `JSON5: ${alias}`;
          }
          if (pkgName === 'compare-versions' && orig === 'compare') {
            return `compare: ${alias}`;
          }
          return `${orig}: ${alias}`;
        }
        return item;
      });
      return `const { ${parts.join(', ')} } = window.parent.TavernHelperMvuLibs;`;
    }
  );

  // 4. Strip export declarations
  processed = processed.replace(/\bexport\s+(const|let|var|function|class)\b/g, "$1");
  processed = processed.replace(/\bexport\s*\{[^}]*\};?/g, "");
  processed = processed.replace(/\bexport\s+default\b/g, "");

  return processed;
}

const path = require('path');
let scripts = [];
const testCardPath = path.join(__dirname, 'test_card_yzym.json');
if (fs.existsSync(testCardPath)) {
  try {
    const c = fs.readFileSync(testCardPath, 'utf8');
    scripts = JSON.parse(c).data?.extensions?.tavern_helper?.scripts || [];
  } catch (e) {
    console.error("Failed to load test card:", e);
  }
}
scripts.forEach((s, i) => {
  if (s.enabled) {
    const clean = preprocessScriptContent(s.content);
    console.log(`=== Script: ${s.name} ===`);
    
    // Check if it still has import/export keywords outside comments
    const hasImport = /^[^\n/]*\bimport\b/m.test(clean);
    const hasExport = /^[^\n/]*\bexport\b/m.test(clean);
    console.log('hasImport:', hasImport);
    console.log('hasExport:', hasExport);
    if (hasImport || hasExport) {
      console.log('STILL HAS IMPORT/EXPORT!');
      // print first few lines of script
      console.log(clean.substring(0, 300));
    }
  }
});
