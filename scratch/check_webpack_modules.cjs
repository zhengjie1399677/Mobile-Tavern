const fs = require('fs');
const card = JSON.parse(fs.readFileSync('C:/Users/20573/Desktop/角色卡/卿卿.json', 'utf8'));
const target = card.data.extensions.regex_scripts.find(s => s.findRegex === '【开场介绍】');

if (target && target.replaceString) {
  let js = target.replaceString;
  js = js.replace(/^```html\s*/i, '').replace(/\s*```$/i, '');
  const scriptContent = js.match(/<script[^>]*>([\s\S]*?)<\/script>/i)[1];
  const importLine = scriptContent.split('\n')[0];
  console.log("Import line:", JSON.stringify(importLine));
  
  // Corrected regex containing \s* between * and as
  const regex = /import\s*\*\s*as\s+(\w+)\s+from\s*['"]https?:\/\/(?:testingcf\.)?jsdelivr\.net\/npm\/([^/]+)\/\+esm['"]/g;
  console.log("Regex test:", regex.test(importLine));
  
  const replaced = importLine.replace(regex, (match, alias, pkgName) => {
    return `const ${alias} = window.parent.TavernHelperMvuLibs.${pkgName};`;
  });
  console.log("Replaced:", JSON.stringify(replaced));
}
