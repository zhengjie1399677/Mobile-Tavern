const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log("Preparing bridge testing workspace...");

const bridgeFilePath = path.join(__dirname, '../src/utils/tavernHelperBridge.ts');
const tempBridgePath = path.join(__dirname, 'temp_bridge.ts');

try {
  let content = fs.readFileSync(bridgeFilePath, 'utf8');

  // Strip/replace raw file ESM imports that trigger protocol load errors in Node.js
  content = content.replace(
    /import\s+mvuBundleContent\s+from\s+["']\.\/mvu_bundle\.js\?raw["'];?/g,
    'const mvuBundleContent = "";'
  );
  content = content.replace(
    /import\s+mvuZodContent\s+from\s+["']\.\/mvu_zod\.js\?raw["'];?/g,
    'const mvuZodContent = "";'
  );
  content = content.replace(
    /import\s+mvuContent\s+from\s+["']\.\/mvu\.js\?raw["'];?/g,
    'const mvuContent = "";'
  );
  content = content.replace(
    /import\s+\*\s+as\s+math\s+from\s+["']mathjs["'];?/g,
    'const math = {};'
  );
  content = content.replace(
    /from\s+["']\.\.\/types["']/g,
    'from "../src/types"'
  );
  content = content.replace(
    /from\s+["']\.\/mvu_zod["']/g,
    'from "../src/utils/mvu_zod"'
  );

  fs.writeFileSync(tempBridgePath, content, 'utf8');
  console.log("Generated temp_bridge.ts successfully.");

  console.log("Running unit tests...");
  execSync('npx tsx tests/test_bridge_runner.ts', { stdio: 'inherit' });

} catch (e) {
  console.error("Test execution failed:", e.message);
  process.exit(1);
} finally {
  try {
    if (fs.existsSync(tempBridgePath)) {
      fs.unlinkSync(tempBridgePath);
      console.log("Cleaned up temp_bridge.ts.");
    }
  } catch (cleanErr) {
    console.error("Failed to clean up temp_bridge.ts:", cleanErr.message);
  }
}
