import fs from 'fs';
import https from 'https';

const url = 'https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/book-open.svg';
const pngUrl = 'https://github.com/fluidicon.png';

https.get(pngUrl, (res) => {
  const data = [];
  res.on('data', (chunk) => data.push(chunk));
  res.on('end', () => {
    const buffer = Buffer.concat(data);
    fs.writeFileSync('app-icon.png', buffer);
    console.log('Downloaded real PNG icon of size:', buffer.length);
  });
}).on('error', (err) => {
  console.error(err);
});
