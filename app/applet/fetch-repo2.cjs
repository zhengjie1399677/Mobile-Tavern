const fs = require('fs');
const https = require('https');
const { execSync } = require('child_process');

const url = 'https://github.com/zhengjie1399677/Mobile-Tavern/archive/refs/heads/main.zip';
const dest = '/app/applet/repo2.zip';

https.get(url, (response) => {
  if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
    https.get(response.headers.location, (res) => {
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        execSync('npx -y extract-zip-cli /app/applet/repo2.zip -d /app/applet/temp-dir2', { stdio: 'inherit' });
      });
    });
  }
});
