import puppeteer from 'puppeteer';
import fs from 'fs';

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#1e1e24";
    ctx.fillRect(0, 0, 400, 400);
    ctx.fillStyle = "#ececec";
    ctx.fillText("Test", 200, 200);
    
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      }, "image/png");
    });
  }).then(dataUrl => {
    const b64 = dataUrl.split(',')[1];
    fs.writeFileSync('browser_canvas.png', Buffer.from(b64, 'base64'));
    console.log("Written browser_canvas.png");
  });
  
  // also inject
  await page.evaluate((b64) => {
    function crc32(buf) {
      // (simplified)
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

    const binary = atob(b64);
    const pngBuffer = new Uint8Array(binary.length);
    for(let i=0; i<binary.length; i++) pngBuffer[i] = binary.charCodeAt(i);
    
    const insertOffset = 33;
    const jsonStr = JSON.stringify({ hello: "world" });
    const base64Str = btoa(unescape(encodeURIComponent(jsonStr)));
    
    const keywordBytes = new TextEncoder().encode("chara");
    const valueBytes = new TextEncoder().encode(base64Str);
    
    const chunkData = new Uint8Array(keywordBytes.length + 1 + valueBytes.length);
    chunkData.set(keywordBytes, 0);
    chunkData.set([0], keywordBytes.length);
    chunkData.set(valueBytes, keywordBytes.length + 1);
    
    const typeBytes = new TextEncoder().encode("tEXt");
    const metaChunk = new Uint8Array(4 + 4 + chunkData.length + 4);
    const metaView = new DataView(metaChunk.buffer, metaChunk.byteOffset, metaChunk.byteLength);
    
    metaView.setUint32(0, chunkData.length);
    metaChunk.set(typeBytes, 4);
    metaChunk.set(chunkData, 8);
    
    const crcInput = new Uint8Array(4 + chunkData.length);
    crcInput.set(typeBytes, 0);
    crcInput.set(chunkData, 4);
    metaView.setUint32(8 + chunkData.length, crc32(crcInput));
    
    const output = new Uint8Array(pngBuffer.byteLength + metaChunk.length);
    output.set(pngBuffer.slice(0, insertOffset), 0);
    output.set(metaChunk, insertOffset);
    output.set(pngBuffer.slice(insertOffset), insertOffset + metaChunk.length);
    
    let outB64 = '';
    for(let i=0; i<output.length; ++i) outB64 += String.fromCharCode(output[i]);
    return btoa(outB64);
  }, fs.readFileSync('browser_canvas.png').toString('base64')).then(outB64 => {
    fs.writeFileSync('browser_canvas_injected.png', Buffer.from(outB64, 'base64'));
    console.log("Written browser_canvas_injected.png");
  });

  await browser.close();
})();
