const { execSync } = require('child_process');

console.log('Ensuring latest frontend is compiled...');
try {
  execSync('npm run build', { stdio: 'inherit' });
} catch (err) {
  console.error('Frontend build failed. Stop.');
  process.exit(1);
}

const maxRetries = 3;
for (let i = 0; i < maxRetries; i++) {
  try {
    console.log('Attempt ' + (i + 1) + ' to build Android APK...');
    execSync('npx tauri android build --apk --target aarch64', { stdio: 'inherit' });
    console.log('Build succeeded.');
    process.exit(0);
  } catch (err) {
    console.error('Build attempt ' + (i + 1) + ' failed.');
    try {
      console.log('Running gradlew assembleRelease with detailed logging for diagnosis...');
      execSync('cd src-tauri/gen/android && chmod +x gradlew && ./gradlew assembleRelease --stacktrace --info', { stdio: 'inherit', env: process.env });
      console.log('Build succeeded via gradlew directly.');
      process.exit(0);
    } catch(err2) {
      console.error('Direct gradlew build also failed.');
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