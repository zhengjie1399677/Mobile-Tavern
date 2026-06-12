/**
 * extract-builtin-avatars.cjs
 * 
 * 将 builtInCharacters.ts 中内嵌的 base64 头像提取为独立的静态图片文件，
 * 并将文件中的 base64 字符串替换为 URL 路径引用。
 * 
 * 运行方式: node scripts/extract-builtin-avatars.cjs
 */

const fs = require('fs');
const path = require('path');

const SOURCE_FILE = path.join(__dirname, '..', 'src', 'utils', 'builtInCharacters.ts');
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'avatars', 'builtin');

// 确保输出目录存在
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

console.log('📖 读取 builtInCharacters.ts...');
let content = fs.readFileSync(SOURCE_FILE, 'utf8');
const originalSize = Buffer.byteLength(content, 'utf8');
console.log(`   原文件大小: ${(originalSize / 1024 / 1024).toFixed(2)} MB`);

// 提取所有 "id" 字段
const idRegex = /"id":\s*"([^"]+)"/g;
const ids = [];
let idMatch;
while ((idMatch = idRegex.exec(content)) !== null) {
  ids.push({ id: idMatch[1], index: idMatch.index });
}
console.log(`\n🔍 找到 ${ids.length} 个 id 字段`);

// 提取所有 avatar data URL（逐段匹配以避免超大 base64 串的正则回溯问题）
const avatarStartToken = '"avatar": "data:image/';
const avatarEndToken = '"';
const avatars = [];

let searchFrom = 0;
while (true) {
  const startIdx = content.indexOf(avatarStartToken, searchFrom);
  if (startIdx === -1) break;

  // 从 "avatar": " 之后找到对应的结束引号
  const dataStart = startIdx + '"avatar": "'.length;
  const dataEnd = content.indexOf('"', dataStart);
  if (dataEnd === -1) break;

  const dataUrl = content.slice(dataStart, dataEnd);

  // 解析 mime type 和 base64 数据
  const mimeMatch = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,/);
  if (mimeMatch) {
    const base64 = dataUrl.slice(mimeMatch[0].length);
    avatars.push({
      fullMatch: content.slice(startIdx, dataEnd + 1), // 包括前后引号
      dataUrl,
      mimeType: mimeMatch[1],
      base64,
      index: startIdx,
    });
  }

  searchFrom = dataEnd + 1;
}

console.log(`🖼️  找到 ${avatars.length} 个 avatar base64 数据\n`);

// 匹配每个 avatar 和它最近的前置 id
let newContent = content;
for (let i = 0; i < avatars.length; i++) {
  const avatar = avatars[i];

  // 找最近的前置 id
  const precedingIds = ids.filter(id => id.index < avatar.index);
  if (precedingIds.length === 0) {
    console.warn(`⚠️  avatar[${i}] 找不到前置 id，跳过`);
    continue;
  }
  const charId = precedingIds[precedingIds.length - 1].id;

  // 文件名
  const ext = avatar.mimeType === 'jpeg' ? 'jpg' : avatar.mimeType;
  const fileName = `${charId}.${ext}`;
  const filePath = path.join(OUTPUT_DIR, fileName);

  // 写图片文件
  const buffer = Buffer.from(avatar.base64, 'base64');
  fs.writeFileSync(filePath, buffer);
  console.log(`✅ ${charId}`);
  console.log(`   → public/avatars/builtin/${fileName}`);
  console.log(`   图片大小: ${(buffer.length / 1024).toFixed(1)} KB`);

  // 替换内容（每个 base64 串全局唯一，用 indexOf+slice 精准替换）
  const urlPath = `/avatars/builtin/${fileName}`;
  const replaceWith = `"avatar": "${urlPath}"`;
  newContent = newContent.replace(avatar.fullMatch, replaceWith);
  console.log(`   替换为: "${urlPath}"\n`);
}

// 写回修改后的 TS 文件
fs.writeFileSync(SOURCE_FILE, newContent, 'utf8');
const newSize = Buffer.byteLength(newContent, 'utf8');

console.log('━'.repeat(50));
console.log(`🎉 完成！`);
console.log(`   原文件大小: ${(originalSize / 1024 / 1024).toFixed(2)} MB`);
console.log(`   新文件大小: ${(newSize / 1024).toFixed(1)} KB`);
console.log(`   缩减: ${((1 - newSize / originalSize) * 100).toFixed(1)}%`);
console.log(`   图片输出目录: ${OUTPUT_DIR}`);
