const fs = require('fs');
const path = require('path');

let pngBuffer;
const iconSourcePath = path.join(__dirname, 'app-icon.png');

if (fs.existsSync(iconSourcePath)) {
  pngBuffer = fs.readFileSync(iconSourcePath);
  console.log(`Using app-icon.png source of size ${pngBuffer.length} bytes`);
} else {
  const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  pngBuffer = Buffer.from(base64Png, 'base64');
  console.log('Falling back to blank 1x1 PNG');
}

const iconsDir = path.join(__dirname, 'src-tauri', 'icons');

if (fs.existsSync(iconsDir)) {
  const files = fs.readdirSync(iconsDir);
  files.forEach(file => {
    if (file.endsWith('.png')) {
      fs.writeFileSync(path.join(iconsDir, file), pngBuffer);
      console.log(`Overwrote ${file} with actual valid PNG content`);
    } else if (file.endsWith('.ico') || file.endsWith('.icns')) {
      // Keep original or custom icons
    }
  });
}

