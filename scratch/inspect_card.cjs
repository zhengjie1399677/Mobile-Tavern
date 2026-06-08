const fs = require('fs');
const content = fs.readFileSync('C:/Users/20573/Desktop/角色卡/卿卿.json', 'utf8');
const data = JSON.parse(content);

console.log("Card Name:", data.name);
console.log("first_mes length:", data.first_mes ? data.first_mes.length : 0);
console.log("first_mes:", data.first_mes ? data.first_mes.substring(0, 100) : "none");

// Check alternate greetings
const charData = data.data || {};
console.log("charData.alternate_greetings:", charData.alternate_greetings ? charData.alternate_greetings.length : 0);
if (charData.alternate_greetings) {
  charData.alternate_greetings.forEach((g, idx) => {
    console.log(`Greeting ${idx + 1}:`, g.substring(0, 100));
  });
}
