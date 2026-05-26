const fs = require('fs');

let content = fs.readFileSync('src/App.tsx', 'utf8');

const lastReturnIdx = content.lastIndexOf('  return (');
const body = content.substring(content.indexOf('export default function App() {'), lastReturnIdx);

const vars = [];
const regex = /(?:const|let|async function|function)\s+(?:\[([^\]]+)\]|([a-zA-Z0-9_]+))\s*(?:=|\()/g;
let match;
while ((match = regex.exec(body)) !== null) {
  if (match[1]) {
    vars.push(...match[1].split(',').map(s => s.trim()));
  } else if (match[2]) {
    vars.push(match[2].trim());
  }
}

const uniqueVars = [...new Set(vars)].filter(Boolean);
console.log(uniqueVars.join(', '));
