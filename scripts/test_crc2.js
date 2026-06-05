import { crc32 } from 'zlib';

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

function myCrc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
  }
  return ((crc ^ 0xFFFFFFFF) >>> 0);
}

const buf = Buffer.from("tEXtchara\0base64datahere");
console.log("Mine:", myCrc32(buf).toString(16));
console.log("Zlib:", crc32(buf).toString(16));
