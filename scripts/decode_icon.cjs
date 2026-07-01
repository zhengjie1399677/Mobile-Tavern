/**
 * decode_icon.cjs
 *
 * CI 图标准备脚本。
 * 职责：确保项目根目录下存在合法的 1024x1024 PNG 图标文件 app-icon.png，
 * 供后续 `npx tauri icon` 命令使用。
 *
 * 策略：
 *   1. 优先检测 Git LFS 签出的 app-icon.png 是否为有效 PNG（非 LFS 指针文件）。
 *   2. 若文件不存在或仍是 LFS 指针文件（< 1 KB），则在本地生成一个最小的
 *      1024x1024 纯色 PNG 作为 Fallback，确保构建不会因图标缺失而中断。
 *
 * 运行方式: node scripts/decode_icon.cjs
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ICON_PATH = path.join(__dirname, '..', 'app-icon.png');

// ─── PNG 签名验证 ─────────────────────────────────────────────────────────────

function isValidPng(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    // LFS 指针文件通常 < 200 字节，且不以 PNG 魔数开头
    if (buf.length < 1024) return false;
    // PNG 文件头魔数: 89 50 4E 47 0D 0A 1A 0A
    return (
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a
    );
  } catch {
    return false;
  }
}

// ─── 最小合法 1024x1024 PNG 生成器 ──────────────────────────────────────────

/**
 * 生成一个最小的 1024x1024 深色单色 PNG（#0f172a）。
 * 使用原始 PNG 块构造，无外部依赖。
 */
function generateFallbackPng() {
  const WIDTH = 1024;
  const HEIGHT = 1024;

  // ── 辅助：CRC32 ────────────────────────────────────────────────────────────
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      t[i] = c;
    }
    return t;
  })();

  function crc32(buf, start, len) {
    let crc = 0xffffffff;
    for (let i = start; i < start + len; i++) {
      crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function writeUint32BE(buf, offset, val) {
    buf[offset] = (val >>> 24) & 0xff;
    buf[offset + 1] = (val >>> 16) & 0xff;
    buf[offset + 2] = (val >>> 8) & 0xff;
    buf[offset + 3] = val & 0xff;
  }

  function makeChunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const len = data.length;
    const chunk = Buffer.alloc(4 + 4 + len + 4);
    writeUint32BE(chunk, 0, len);
    typeBuf.copy(chunk, 4);
    data.copy(chunk, 8);
    const crc = crc32(chunk, 4, 4 + len);
    writeUint32BE(chunk, 8 + len, crc);
    return chunk;
  }

  // ── IHDR ──────────────────────────────────────────────────────────────────
  const ihdr = Buffer.alloc(13);
  writeUint32BE(ihdr, 0, WIDTH);
  writeUint32BE(ihdr, 4, HEIGHT);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // ── 原始图像数据（RGB 行，每行前置滤镜字节 0）─────────────────────────────
  // 颜色: #0f172a (r=15, g=23, b=42)
  const R = 0x0f, G = 0x17, B = 0x2a;
  const rowSize = 1 + WIDTH * 3; // filter byte + RGB pixels
  const rawData = Buffer.alloc(HEIGHT * rowSize);
  for (let y = 0; y < HEIGHT; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // None filter
    for (let x = 0; x < WIDTH; x++) {
      rawData[rowOffset + 1 + x * 3] = R;
      rawData[rowOffset + 2 + x * 3] = G;
      rawData[rowOffset + 3 + x * 3] = B;
    }
  }

  // ── 压缩 IDAT ─────────────────────────────────────────────────────────────
  const compressed = zlib.deflateSync(rawData, { level: 1 });

  // ── 拼合完整 PNG ─────────────────────────────────────────────────────────
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

const SOURCE_LOGO_PATH = path.join(__dirname, '..', 'public', 'logo.png');

if (isValidPng(SOURCE_LOGO_PATH)) {
  console.log(`✅ 检测到 public/logo.png 为有效新版 Logo，复制为 app-icon.png 作为打包源...`);
  try {
    fs.copyFileSync(SOURCE_LOGO_PATH, ICON_PATH);
  } catch (err) {
    console.error('Failed to copy public/logo.png to app-icon.png:', err);
  }
}

if (isValidPng(ICON_PATH)) {
  const size = fs.statSync(ICON_PATH).size;
  console.log(`✅ app-icon.png 已存在且为有效 PNG（${(size / 1024).toFixed(1)} KB），跳过生成。`);
} else {
  console.log('⚠️  app-icon.png 缺失且无法使用 public/logo.png，正在生成 Fallback 图标...');
  const pngBuf = generateFallbackPng();
  fs.writeFileSync(ICON_PATH, pngBuf);
  console.log(`✅ Fallback app-icon.png 已生成（${(pngBuf.length / 1024).toFixed(1)} KB，1024×1024 深色单色）。`);
}
