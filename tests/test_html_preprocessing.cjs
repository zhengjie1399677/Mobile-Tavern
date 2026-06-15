const fs = require('fs');
const card = JSON.parse(fs.readFileSync('C:/Users/20573/Desktop/角色卡/卿卿.json', 'utf8'));
const target = card.data.extensions.regex_scripts.find(s => s.findRegex === '【开场介绍】');

// Mock preprocessScriptContent
function preprocessScriptContent(content) {
  let processed = content;
  // Namespace ESM imports replacement
  processed = processed.replace(
    /import\s*\*as\s+(\w+)\s+from\s*['"]https?:\/\/(?:testingcf\.)?jsdelivr\.net\/npm\/([^/]+)\/\+esm['"]/g,
    (match, alias, pkgName) => {
      return `const ${alias} = window.parent.TavernHelperMvuLibs.${pkgName};`;
    }
  );
  return processed;
}

if (target && target.replaceString) {
  let html = target.replaceString;
  let processedHtml = html.replace(
    /<script([^>]*)>([\s\S]*?)<\/script>/gi,
    (match, attrs, scriptBody) => {
      if (/type\s*=\s*['"]module['"]/i.test(attrs) || /import\s+/.test(scriptBody)) {
        return `<script${attrs}>${preprocessScriptContent(scriptBody)}</script>`;
      }
      return match;
    }
  );
  
  console.log("=== Original Start ===");
  console.log(html.substring(0, 500));
  console.log("=== Processed Start ===");
  console.log(processedHtml.substring(0, 500));
}
