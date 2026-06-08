const fs = require('fs');
const content = fs.readFileSync('d:/projects/Mobile-Tavern/src/utils/mvu_bundle.js', 'utf8');

console.log('=== should_enable computation analysis ===\n');

// 1. Find the full U store definition
console.log('1. Finding U store definition:');
const uStoreIdx = content.indexOf("n('MVU变量框架'");
if (uStoreIdx !== -1) {
  // Find the complete store by looking for the pattern
  // n('MVU变量框架', () => { ... })
  const beforeStore = content.substring(0, uStoreIdx);
  const lastParen = beforeStore.lastIndexOf('(');
  const storeStart = lastParen;
  
  // Find matching closing paren
  let parenCount = 1;
  let endIdx = uStoreIdx;
  for (let i = uStoreIdx + "n('MVU变量框架'".length; i < content.length; i++) {
    if (content[i] === '(') parenCount++;
    else if (content[i] === ')') {
      parenCount--;
      if (parenCount === 0) {
        endIdx = i + 1;
        break;
      }
    }
  }
  
  const storeDef = content.substring(storeStart, endIdx);
  console.log('   Store definition (first 3000 chars):');
  console.log(`   ${storeDef.substring(0, 3000).replace(/\n/g, '\n   ')}`);
}

// 2. Find should_enable computation
console.log('\n2. should_enable computation:');
const shouldIdx = content.indexOf('should_enable');
if (shouldIdx !== -1) {
  // Find all occurrences
  let searchIdx = 0;
  let count = 0;
  while (count < 5) {
    const idx = content.indexOf('should_enable', searchIdx);
    if (idx === -1) break;
    
    const context = content.substring(Math.max(0, idx - 50), Math.min(content.length, idx + 150));
    console.log(`\n   Occurrence ${count + 1}:`);
    console.log(`   ${context.replace(/\n/g, ' ').substring(0, 200)}`);
    
    searchIdx = idx + 1;
    count++;
  }
}

// 3. Find where extensionSettings is accessed
console.log('\n3. extensionSettings access in store:');
const extIdx = content.indexOf("SillyTavern.extensionSettings,'mvu_settings'");
if (extIdx !== -1) {
  const context = content.substring(Math.max(0, extIdx - 100), Math.min(content.length, extIdx + 300));
  console.log('   Context:');
  console.log(`   ${context.replace(/\n/g, ' ').substring(0, 400)}`);
}

// 4. Find the M.parse call
console.log('\n4. M.parse (schema parsing) context:');
const parseIdx = content.indexOf('M.parse(_.get(SillyTavern.extensionSettings');
if (parseIdx !== -1) {
  const context = content.substring(Math.max(0, parseIdx - 50), Math.min(content.length, parseIdx + 200));
  console.log('   Context:');
  console.log(`   ${context.replace(/\n/g, ' ').substring(0, 250)}`);
}

// 5. Find what M is (likely the Zod schema)
console.log('\n5. M definition:');
const mDefIdx = content.indexOf('M=');
if (mDefIdx !== -1) {
  // Look for M definition near the store
  const beforeStore = content.substring(0, uStoreIdx || 50000);
  const mDefInBefore = beforeStore.lastIndexOf('M=');
  if (mDefInBefore !== -1) {
    const context = content.substring(Math.max(0, mDefInBefore - 50), Math.min(content.length, mDefInBefore + 500));
    console.log('   M definition context:');
    console.log(`   ${context.replace(/\n/g, ' ').substring(0, 550)}`);
  }
}

// 6. Find the complete watch that sets Mvu
console.log('\n6. Complete IIFE that sets Mvu:');
const mvuSetIdx = content.indexOf("_.set(window.parent,'Mvu',e)");
if (mvuSetIdx !== -1) {
  // Find the IIFE start
  const beforeMvu = content.substring(0, mvuSetIdx);
  const iifeStart = beforeMvu.lastIndexOf('n.push(function(){');
  if (iifeStart !== -1) {
    // Find the IIFE end
    let braceCount = 0;
    let inFunc = false;
    let endIdx = iifeStart;
    for (let i = iifeStart; i < content.length; i++) {
      if (content[i] === '{') {
        braceCount++;
        inFunc = true;
      } else if (content[i] === '}') {
        braceCount--;
        if (inFunc && braceCount === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }
    const iife = content.substring(iifeStart, endIdx);
    console.log('   Full IIFE:');
    console.log(`   ${iife.replace(/\n/g, '\n   ').substring(0, 1000)}`);
  }
}

// 7. Check if there's a default value for should_enable
console.log('\n7. Default settings structure:');
// Look for the schema default structure
const schemaIdx = content.indexOf('prefault({})');
if (schemaIdx !== -1) {
  const context = content.substring(Math.max(0, schemaIdx - 500), Math.min(content.length, schemaIdx + 100));
  console.log('   Schema context:');
  console.log(`   ${context.replace(/\n/g, ' ').substring(0, 600)}`);
}
