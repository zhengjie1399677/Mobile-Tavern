const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const pngBuffer = Buffer.from(base64Png, 'base64');

const iconsDir = path.join(__dirname, 'src-tauri', 'icons');

if (fs.existsSync(iconsDir)) {
  const files = fs.readdirSync(iconsDir);
  files.forEach(file => {
    if (file.endsWith('.png')) {
      fs.writeFileSync(path.join(iconsDir, file), pngBuffer);
      console.log(`Overwrote ${file} with solid blank PNG`);
    } else if (file.endsWith('.ico') || file.endsWith('.icns')) {
      // let's just make it a png, actually tauri might complain if it's not a real icns/ico, but maybe it won't.
      // Alternatively, we can use an actual base64 of an ico file.
    }
  });
}
