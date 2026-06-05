const AdmZip = require('adm-zip');
const fs = require('fs');
const https = require('https');
const { execSync } = require('child_process');
const path = require('path');

const url = 'https://github.com/zhengjie1399677/Mobile-Tavern/archive/refs/heads/main.zip';
const dest = path.join(__dirname, 'repo.zip');

console.log('Downloading...');

https.get(url, (response) => {
  if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
    https.get(response.headers.location, (res) => {
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log('Download complete.');
        try {
          const zip = new AdmZip(dest);
          zip.extractAllTo(path.join(__dirname, 'target_dir'), true);
          console.log('Extraction complete.');
          
          const sourceFolder = path.join(__dirname, 'target_dir/Mobile-Tavern-main');
          const files = fs.readdirSync(sourceFolder);
          for (const file of files) {
            execSync(`npx -y shx cp -rf "${path.join(sourceFolder, file)}" .`, { stdio: 'inherit' });
          }
          execSync('npx -y shx rm -rf repo.zip target_dir', { stdio: 'inherit' });
          console.log('Moved files and cleaned up.');
        } catch (e) {
          console.error('Failed to extract:', e);
        }
      });
    });
  }
}).on('error', (err) => {
  console.error('Download error:', err);
});
