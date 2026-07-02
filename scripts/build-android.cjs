const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Override ANDROID_HOME to the correct location on Windows and add platform-tools to PATH
if (process.platform === 'win32') {
  const userProfile = process.env.USERPROFILE || process.env.HOME || '';
  const possiblePaths = [
    'E:\\modules\\ide\\android-sdk',
    path.join(userProfile, 'AppData', 'Local', 'Android', 'Sdk'),
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
  execSync('npm run build', { stdio: 'inherit', shell: true });
} catch (err) {
  console.error('Frontend build failed. Stop.');
  process.exit(1);
}

// Generate and sync launcher icons
console.log('Generating and syncing launcher icons...');
try {
  execSync('node scripts/decode_icon.cjs', { stdio: 'inherit', shell: true });
} catch (err) {
  console.error('Failed to run decode_icon.cjs script:', err.message);
}

// Clean Gradle cache to prevent stale resource caching of old icons
console.log('Cleaning Gradle cache to prevent stale resource caching...');
try {
  const gradlewCmd = process.platform === 'win32' ? 'gradlew.bat clean' : './gradlew clean';
  execSync(gradlewCmd, { cwd: path.join(__dirname, '..', 'src-tauri', 'gen', 'android'), stdio: 'inherit', shell: true });
  console.log('✅ Gradle clean completed.');
} catch (err) {
  console.warn('⚠️ Gradle clean failed, proceeding anyway:', err.message);
}

const isCI = process.env.CI === 'true';
const maxRetries = isCI ? 5 : 3;
const retryDelayMs = isCI ? 15000 : 5000;

if (isCI) {
  console.log('CI environment detected. Building RELEASE APK...');
} else {
  console.log('Local environment detected. Building DEBUG APK (automatically signed with local debug keys)...');
}

for (let i = 0; i < maxRetries; i++) {
  try {
    console.log(`Attempt ${i + 1}/${maxRetries} to build Android APK...`);
    const buildCmd = isCI
      ? 'npx tauri android build --apk --target aarch64 --verbose'
      : 'npx tauri android build --apk --debug --target aarch64 --verbose';
    execSync(buildCmd, { stdio: 'inherit', shell: true });
    console.log('Build succeeded.');
    process.exit(0);
  } catch (err) {
    console.error(`Build attempt ${i + 1}/${maxRetries} failed.`);
    if (i === maxRetries - 1) {
      console.error('All build attempts failed.');
      process.exit(1);
    }
    console.log(`Retrying in ${retryDelayMs / 1000} seconds...`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, retryDelayMs);
  }
}