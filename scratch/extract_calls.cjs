const fs = require('fs');
const content = fs.readFileSync('C:/Users/20573/Desktop/角色卡/卿卿.json', 'utf8');

// Search for references to the root schema variable 'd' or 'l'
// Let's print aroundconst i=Vue,A=z
const start = content.indexOf('const i=Vue,A=z');
if (start !== -1) {
  console.log(content.slice(start, start + 1000));
} else {
  console.log('Not found');
}
