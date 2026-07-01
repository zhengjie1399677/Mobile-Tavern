const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Recursive directory copying helper
function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

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
  execSync('npm run build', { stdio: 'inherit' });
} catch (err) {
  console.error('Frontend build failed. Stop.');
  process.exit(1);
}

// Sync generated launcher icons to Android res directory before Tauri build
console.log('Syncing launcher icons to Android res directory...');
try {
  const srcIconsDir = path.join(__dirname, '..', 'src-tauri', 'icons', 'android');
  const destResDir = path.join(__dirname, '..', 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'res');
  if (fs.existsSync(srcIconsDir)) {
    copyDirRecursive(srcIconsDir, destResDir);
    console.log('✅ Icon sync complete.');
  } else {
    console.warn('⚠️ Source icons directory not found, skipping sync:', srcIconsDir);
  }
} catch (err) {
  console.error('Failed to sync icons:', err);
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
    execSync(buildCmd, { stdio: 'inherit' });
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