const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'temp-dir');
const destDir = __dirname;

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const file of fs.readdirSync(src)) {
    if (file === '.git') continue;
    const srcFile = path.join(src, file);
    const destFile = path.join(dest, file);
    if (fs.lstatSync(srcFile).isDirectory()) {
      copyDir(srcFile, destFile);
    } else {
      fs.copyFileSync(srcFile, destFile);
    }
  }
}

console.log('Copying files from temp-dir to applet root...');
copyDir(srcDir, destDir);
console.log('Done.');
