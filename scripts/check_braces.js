import * as fs from 'fs';
const text = fs.readFileSync('src/App.tsx', 'utf8');
let openBraces = 0;
let errors = [];
const lines = text.split('\n');
for(let i=0; i<lines.length; i++) {
    for(let char of lines[i]) {
        if(char === '{') openBraces++;
        if(char === '}') openBraces--;
    }
}
console.log("Total brace balance:", openBraces);
