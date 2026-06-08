const fs = require('fs');
const content = fs.readFileSync('C:/Users/20573/Desktop/角色卡/卿卿.json', 'utf8');

// Find the template HTML content in the card
const regex = /<div[\s\S]*?<\/div>/;
const match = regex.exec(content);
if (match) {
  console.log("Template:", match[0].substring(0, 1500));
} else {
  console.log("Template not found");
}

// Find click handlers in template
const clickRegex = /@click="[^"]*"/g;
let cMatch;
while ((cMatch = clickRegex.exec(content))) {
  console.log("Click Handler:", cMatch[0]);
}
