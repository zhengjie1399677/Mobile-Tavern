const fs = require('fs');
const content = fs.readFileSync('C:/Users/20573/Desktop/角色卡/卿卿.json', 'utf8');

const regex = /selectOpening[\s\S]*?\)/g;
let match;
while ((match = regex.exec(content))) {
  console.log("Found call:", match[0]);
}

// Search for v-for or button list in the JSON content
const buttonRegex = /<div class="qr-opening-item"[^>]*>([\s\S]*?)<\/div>/g;
let btnMatch;
while ((btnMatch = buttonRegex.exec(content))) {
  console.log("Button item HTML:", btnMatch[0]);
}
