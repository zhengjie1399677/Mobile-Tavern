const fs = require('fs');
const content = fs.readFileSync('C:/Users/20573/Desktop/角色卡/卿卿.json', 'utf8');

// Find all occurrences of A.z.object
const regex = /A\.z\.object\(\{[\s\S]*?\}\)/g;
let match;
while ((match = regex.exec(content))) {
  console.log('--- Found Schema ---');
  console.log(match[0]);
}
