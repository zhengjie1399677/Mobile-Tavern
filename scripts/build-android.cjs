const { execSync } = require('child_process');
const path = require('path');


// Override ANDROID_HOME to the correct location on Windows and add platform-tools to PATH
if (process.platform === 'win32') {
  const fs = require('fs');
  const possiblePaths = [
    'E:\\modules\\ide\\android-sdk',
    'C:\\Users\\20573\\AppData\\Local\\Android\\Sdk',
  ];
  let sdkPath = process.env.ANDROID_HOME;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      sdkPath = p;
      break;
    }
  }
  if (sdkPath) {
    process.env.ANDROID_HOME = sdkPath;
    process.env.PATH = sdkPath + '\\platform-tools;' + process.env.PATH;
    console.log('Using Android SDK at: ' + sdkPath);
  }
}


console.log('Ensuring latest frontend is compiled...');
try {
  execSync('npm run build', { stdio: 'inherit' });
} catch (err) {
  console.error('Frontend build failed. Stop.');
  process.exit(1);
}

const maxRetries = 3;
const isCI = process.env.CI === 'true';

if (isCI) {
  console.log('CI environment detected. Building RELEASE APK...');
} else {
  console.log('Local environment detected. Building DEBUG APK (automatically signed with local debug keys)...');
}

for (let i = 0; i < maxRetries; i++) {
  try {
    console.log('Attempt ' + (i + 1) + ' to build Android APK...');
    const buildCmd = isCI 
      ? 'npx tauri android build --apk --target aarch64 --verbose'
      : 'npx tauri android build --apk --debug --target aarch64 --verbose';
    execSync(buildCmd, { stdio: 'inherit' });
    console.log('Build succeeded.');
    process.exit(0);
  } catch (err) {
    console.error('Build attempt ' + (i + 1) + ' failed. Error details:', err);
    try {
      const gradlewTask = isCI ? 'assembleRelease' : 'assembleDebug';
      console.log(`Running gradlew ${gradlewTask} with detailed logging for diagnosis...`);
      const gradlewCmd = process.platform === 'win32'
        ? `cd src-tauri/gen/android && gradlew.bat ${gradlewTask} --stacktrace --info`
        : `cd src-tauri/gen/android && chmod +x gradlew && ./gradlew ${gradlewTask} --stacktrace --info`;
      execSync(gradlewCmd, { stdio: 'inherit', env: process.env });
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
    try {
      const cleanCmd = process.platform === 'win32'
        ? 'cd src-tauri/gen/android && gradlew.bat clean'
        : 'cd src-tauri/gen/android && ./gradlew clean';
      execSync(cleanCmd, { stdio: 'inherit' });
    } catch(e) {}
    console.log('Retrying in 5 seconds...');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
  }
}