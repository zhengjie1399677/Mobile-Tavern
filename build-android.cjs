const { execSync } = require('child_process');
const maxRetries = 3;
for (let i = 0; i < maxRetries; i++) {
  try {
    console.log('Attempt ' + (i + 1) + ' to build Android APK...');
    execSync('npx tauri android build --apk --debug -v --target aarch64,armv7', { stdio: 'inherit' });
    console.log('Build succeeded.');
    process.exit(0);
  } catch (err) {
    console.error('Build attempt ' + (i + 1) + ' failed.');
    try {
      console.log('Running gradlew assembleDebug with detailed logging for diagnosis...');
      execSync('cd src-tauri/gen/android && chmod +x gradlew && ./gradlew assembleDebug --stacktrace --info', { stdio: 'inherit', env: process.env });
      console.log('Build succeeded via gradlew directly.');
      process.exit(0);
    } catch(err2) {
      console.error('Direct gradlew build also failed.');
      try {
        const fs = require('fs');
        console.log("settings.gradle content:\n" + fs.readFileSync('src-tauri/gen/android/settings.gradle', 'utf8'));
        if (fs.existsSync('src-tauri/gen/android/build.tauri.gradle')) {
          console.log("build.tauri.gradle content:\n" + fs.readFileSync('src-tauri/gen/android/build.tauri.gradle', 'utf8'));
        } else {
          console.log("build.tauri.gradle DOES NOT EXIST");
        }
      } catch(e) {
        console.error("Failed to read debug files:", e.message);
      }
    }
    if (i === maxRetries - 1) {
      console.error('All build attempts failed.');
      process.exit(1);
    }
    console.log('Cleaning before retrying...');
    try { execSync('cd src-tauri/gen/android && ./gradlew clean', { stdio: 'inherit' }); } catch(e) {}
    console.log('Retrying in 5 seconds...');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
  }
}