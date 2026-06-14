const fs = require('fs');
const path = require('path');

function readPngChara(filePath) {
  const buf = fs.readFileSync(filePath);
  let pos = 8; // skip PNG signature
  
  while (pos < buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    pos += 8;
    
    if (type === 'tEXt') {
      const chunkData = buf.slice(pos, pos + length);
      const nullPos = chunkData.indexOf(0);
      if (nullPos !== -1) {
        const keyword = chunkData.toString('ascii', 0, nullPos);
        if (keyword === 'chara') {
          return chunkData.toString('utf8', nullPos + 1);
        }
      }
    } else if (type === 'iTXt') {
      // Sometimes it might be in iTXt chunk (uncompressed or compressed UTF-8)
      const chunkData = buf.slice(pos, pos + length);
      const nullPos = chunkData.indexOf(0);
      if (nullPos !== -1) {
        const keyword = chunkData.toString('ascii', 0, nullPos);
        if (keyword === 'chara') {
          // iTXt structure: keyword(null) compressionFlag(1) compressionMethod(1) language(null) translated(null) text
          let currentPos = nullPos + 3;
          // skip language
          while (currentPos < chunkData.length && chunkData[currentPos] !== 0) currentPos++;
          currentPos++; // skip null
          // skip translated
          while (currentPos < chunkData.length && chunkData[currentPos] !== 0) currentPos++;
          currentPos++; // skip null
          
          return chunkData.toString('utf8', currentPos);
        }
      }
    }
    pos += length + 4; // skip data + CRC
  }
  return null;
}

const base64Data = readPngChara('C:\\Users\\20573\\Desktop\\内置\\2ff402ce993e8f5e.png');
if (!base64Data) {
  console.log('No chara metadata found in PNG.');
  process.exit(1);
}

try {
  const jsonStr = Buffer.from(base64Data, 'base64').toString('utf8');
  const card = JSON.parse(jsonStr);
  
  console.log('================== CHARACTER CARD SUMMARY ==================');
  console.log('Name:', card.name || card.data?.name);
  console.log('Creator:', card.creator || card.data?.creator);
  console.log('Version:', card.version || card.data?.version);
  
  const extensions = card.data?.extensions || card.extensions || {};
  console.log('Extensions keys:', Object.keys(extensions));
  
  const charBook = card.data?.character_book || card.character_book || {};
  console.log('Has Character Book:', !!charBook.entries);
  if (charBook.entries) {
  // Save full extensions object to file
  const extPath = path.join(__dirname, 'v421_extensions.json');
  fs.writeFileSync(extPath, JSON.stringify(extensions, null, 2), 'utf8');
  console.log(`Full extensions written to: ${extPath}`);
  
  console.log('--- Detailed Extensions Info ---');
  for (const [key, val] of Object.entries(extensions)) {
    if (val && typeof val === 'object') {
      if (Array.isArray(val)) {
        console.log(`Extension key: "${key}" (Array), length: ${val.length}`);
      } else {
        console.log(`Extension key: "${key}" (Object), keys:`, Object.keys(val));
      }
    } else {
      console.log(`Extension key: "${key}", value:`, val);
    }
  }
  }
} catch (e) {
  console.error('Failed to parse JSON:', e);
}
