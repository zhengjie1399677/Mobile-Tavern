const fs = require('fs');

const crcTable = (() => {
  const table = [];
  let c;
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function injectPngMetadata(pngBuffer) {
  const view = new DataView(pngBuffer.buffer, pngBuffer.byteOffset, pngBuffer.byteLength);
  if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) {
    throw new Error("Invalid PNG source file");
  }

  const uint8 = new Uint8Array(pngBuffer);
  const insertOffset = 33;

  const payload = {
    schema: "SillyTavernCard",
    version: 2,
    data: { name: "test" }
  };

  const jsonStr = JSON.stringify(payload);
  const base64Str = Buffer.from(jsonStr).toString('base64');
  
  const keywordBytes = Buffer.from("chara", "utf-8");
  const valueBytes = Buffer.from(base64Str, "utf-8");

  const chunkData = new Uint8Array(keywordBytes.length + 1 + valueBytes.length);
  chunkData.set(keywordBytes, 0);
  chunkData.set([0], keywordBytes.length);
  chunkData.set(valueBytes, keywordBytes.length + 1);

  const typeBytes = Buffer.from("tEXt", "utf-8");
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
  output.set(uint8.slice(0, insertOffset), 0);
  output.set(metaChunk, insertOffset);
  output.set(uint8.slice(insertOffset), insertOffset + metaChunk.length);

  return output;
}

const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const buf = Buffer.from(base64Png, 'base64');

try {
  const result = injectPngMetadata(buf);
  fs.writeFileSync('test_client_inject.png', result);
  console.log("Injected properly.");
} catch(e) {
  console.log("Error:", e);
}
