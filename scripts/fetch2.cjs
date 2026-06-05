const https = require('https');
https.get("https://raw.githubusercontent.com/tauri-apps/tauri/refs/heads/v2.0.0/crates/tauri-cli/templates/mobile/android/settings.gradle", (r) => {
  let s=''; r.on('data',c=>s+=c); r.on('end', ()=>console.log(s));
});
