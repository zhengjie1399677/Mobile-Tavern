const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const canvas = createCanvas(512, 512);
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#4f46e5'; // Indigo background
ctx.fillRect(0, 0, 512, 512);
ctx.fillStyle = '#ffffff';
ctx.font = 'bold 200px Arial';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('ST', 256, 256);

const buffer = canvas.toBuffer('image/png');

const iconSourcePath = path.join(__dirname, 'app-icon.png');
fs.writeFileSync(iconSourcePath, buffer);
console.log('Generated new valid app-icon.png');

const iconsDir = path.join(__dirname, 'src-tauri', 'icons');
if (fs.existsSync(iconsDir)) {
  const files = fs.readdirSync(iconsDir);
  files.forEach(file => {
    if (file.endsWith('.png')) {
      // Create specifically sized icons just to be safe
      const match = file.match(/(\d+)x\d+/i);
      let size = 512;
      if (match) {
        size = parseInt(match[1]);
      } else if (file.toLowerCase().includes('square') && file.match(/\d+/)) {
        size = parseInt(file.match(/\d+/)[0]);
      }
      
      const smallCanvas = createCanvas(size, size);
      const sCtx = smallCanvas.getContext('2d');
      sCtx.fillStyle = '#4f46e5';
      sCtx.fillRect(0, 0, size, size);
      sCtx.fillStyle = '#ffffff';
      sCtx.font = `bold ${Math.floor(size * 0.4)}px Arial`;
      sCtx.textAlign = 'center';
      sCtx.textBaseline = 'middle';
      sCtx.fillText('ST', size/2, size/2);
      
      fs.writeFileSync(path.join(iconsDir, file), smallCanvas.toBuffer('image/png'));
      console.log(`Overwrote ${file} with solid size ${size}`);
    }
  });
}
