const fs = require('fs');
const content = fs.readFileSync('C:/Users/20573/Desktop/角色卡/扬州一梦1.6.1.json', 'utf8');

const regex = /z\.object\(\{[\s\S]*?\}\)/g;
let match;
while ((match = regex.exec(content))) {
  console.log('--- Found Schema ---');
  console.log(match[0]);
}
