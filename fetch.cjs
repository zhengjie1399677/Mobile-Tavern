const https = require('https');
https.get('https://raw.githubusercontent.com/tauri-apps/tauri/v2/tooling/cli/templates/mobile/android/build.tauri.gradle', (res) => {
  let data = '';
  res.on('data', (c) => data += c);
  res.on('end', () => console.log(data));
});
