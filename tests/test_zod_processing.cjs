const fs = require('fs');
const mvuZodContent = fs.readFileSync('src/utils/mvu_zod.js', 'utf8');

const processedMvuZod = mvuZodContent
  .replace(/export\s*\{\s*s\s*as\s*registerMvuSchema\s*\};?/g, "");

console.log('Processed Zod length:', processedMvuZod.length);
console.log('Contains export:', processedMvuZod.includes('export'));
console.log('Last 100 chars:', processedMvuZod.substring(processedMvuZod.length - 100));
