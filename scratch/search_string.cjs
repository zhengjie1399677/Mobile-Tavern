const fs = require('fs');
const content = fs.readFileSync('C:/Users/20573/Desktop/角色卡/卿卿.json', 'utf8');

// Find occurrences of "切换" or "未找到"
const regex = /[^"\n]*切换[^"\n]*/g;
let match;
while ((match = regex.exec(content))) {
  console.log("Match:", match[0]);
}
