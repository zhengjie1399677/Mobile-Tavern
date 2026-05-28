const fs = require('fs');
const { execSync } = require('child_process');
fs.chmodSync('./cargo', '755');
fs.chmodSync('./rustc', '755');
try {
  execSync('npx -y @tauri-apps/cli android init', {
    env: { ...process.env, PATH: process.cwd() + ':' + process.env.PATH, NDK_HOME: '', ANDROID_NDK_HOME: '' },
    stdio: 'inherit'
  });
} catch (e) {
  console.log(e.message);
}
