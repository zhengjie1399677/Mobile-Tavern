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
          execSync('npx -y extract-zip-cli repo.zip -d target_dir', { stdio: 'inherit' });
          console.log('Extraction complete.');
          
          const files = fs.readdirSync('target_dir/Mobile-Tavern-main');
          for (const file of files) {
            execSync(`npx -y shx cp -rf target_dir/Mobile-Tavern-main/${file} .`, { stdio: 'inherit' });
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
