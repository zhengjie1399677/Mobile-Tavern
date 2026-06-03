import fs from 'fs';
import https from 'https';
import { execSync } from 'child_process';

const url = 'https://github.com/zhengjie1399677/Mobile-Tavern/archive/refs/heads/main.zip';
const dest = '/app/repo.zip';

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
          execSync('npx -y unzipper -d /app/Mobile-Tavern /app/repo.zip', { stdio: 'inherit' });
          console.log('Extraction complete.');
        } catch (e) {
          console.error('Failed to extract:', e);
        }
      });
    });
  }
}).on('error', (err) => {
  console.error('Download error:', err);
});
