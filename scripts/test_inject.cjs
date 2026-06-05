const fs = require('fs');

function crc32(buf) {
  let crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function injectPngMetadata(pngBuffer) {
  const insertOffset = 33;
  const jsonStr = JSON.stringify({ hello: "world" });
  const base64Str = Buffer.from(jsonStr).toString('base64');
  
  const keywordBytes = Buffer.from("chara", 'utf8');
  const valueBytes = Buffer.from(base64Str, 'utf8');
  
  const chunkData = new Uint8Array(keywordBytes.length + 1 + valueBytes.length);
  chunkData.set(keywordBytes, 0);
  chunkData.set([0], keywordBytes.length);
  chunkData.set(valueBytes, keywordBytes.length + 1);
  
  const typeBytes = Buffer.from("tEXt", 'utf8');
  const metaChunk = new Uint8Array(4 + 4 + chunkData.length + 4);
  const metaView = new DataView(metaChunk.buffer, metaChunk.byteOffset, metaChunk.byteLength);
  
  metaView.setUint32(0, chunkData.length);
  metaChunk.set(typeBytes, 4);
  metaChunk.set(chunkData, 8);
  
  const crcInput = new Uint8Array(4 + chunkData.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(chunkData, 4);
  const crcVal = crc32(crcInput);
  metaView.setUint32(8 + chunkData.length, crcVal);
  
  const output = new Uint8Array(pngBuffer.byteLength + metaChunk.length);
  output.set(new Uint8Array(pngBuffer).slice(0, insertOffset), 0);
  output.set(metaChunk, insertOffset);
  output.set(new Uint8Array(pngBuffer).slice(insertOffset), insertOffset + metaChunk.length);
  
  return output;
}

const pngBuffer = fs.readFileSync('app-icon.png');
const outBuffer = injectPngMetadata(pngBuffer);
fs.writeFileSync('out_injected.png', Buffer.from(outBuffer));
