/**
 * bump-version.cjs — 应用发布版本号一键同步工具
 *
 * 用法：
 *   npm run bump-version <new_version>
 *   例如：npm run bump-version 1.7.0
 *
 * 职责：
 * 自动精准将新版本号同步写入项目以下物理位置：
 *   1. package.json ("version")
 *   2. src-tauri/tauri.conf.json ("version")
 *   3. src-tauri/Cargo.toml (version = "...")
 *   4. serverless/aliyun-fc-sts/package.json ("version")
 *   5. public/version ("pkgVersion": "...")
 *   6. README.md (徽章 badge/version-...)
 *   7. docs/index.html (声明与下载按钮上的文本展示)
 *   8. package-lock.json (顶层 "version")
 */

const fs = require("fs");
const path = require("path");

const newVersion = process.argv[2];

if (!newVersion || !/^\d+\.\d+\.\d+$/.test(newVersion.trim())) {
  console.error("错误：请提供合法的语义化版本号，例如：npm run bump-version 1.7.0");
  process.exit(1);
}

const targetVersion = newVersion.trim();
const rootDir = path.resolve(__dirname, "..");

console.log(`🚀 开始同步项目发布版本号至: v${targetVersion}\n`);

let successCount = 0;

function updateFile(filePath, updateFn) {
  const absolutePath = path.join(rootDir, filePath);
  if (!fs.existsSync(absolutePath)) {
    console.warn(`⚠️ 文件不存在，跳过: ${filePath}`);
    return;
  }
  try {
    const originalContent = fs.readFileSync(absolutePath, "utf8");
    const updatedContent = updateFn(originalContent);
    if (originalContent !== updatedContent) {
      fs.writeFileSync(absolutePath, updatedContent, "utf8");
      console.log(`✅ 已更新: ${filePath}`);
      successCount++;
    } else {
      console.log(`ℹ️ 无变更 (已是最新): ${filePath}`);
    }
  } catch (err) {
    console.error(`❌ 更新失败: ${filePath}`, err);
  }
}

// 1. package.json
updateFile("package.json", (content) => {
  const json = JSON.parse(content);
  json.version = targetVersion;
  return JSON.stringify(json, null, 2) + "\n";
});

// 2. src-tauri/tauri.conf.json
updateFile("src-tauri/tauri.conf.json", (content) => {
  const json = JSON.parse(content);
  json.version = targetVersion;
  return JSON.stringify(json, null, 2) + "\n";
});

// 3. src-tauri/Cargo.toml
updateFile("src-tauri/Cargo.toml", (content) => {
  return content.replace(/^version\s*=\s*"[^"]+"/m, `version = "${targetVersion}"`);
});

// 4. serverless/aliyun-fc-sts/package.json
updateFile("serverless/aliyun-fc-sts/package.json", (content) => {
  const json = JSON.parse(content);
  json.version = targetVersion;
  return JSON.stringify(json, null, 2) + "\n";
});

// 5. public/version
updateFile("public/version", (content) => {
  try {
    const json = JSON.parse(content);
    json.pkgVersion = targetVersion;
    return JSON.stringify(json, null, 2) + "\n";
  } catch {
    return JSON.stringify({ pkgVersion: targetVersion }, null, 2) + "\n";
  }
});

// 6. README.md 徽章
updateFile("README.md", (content) => {
  return content.replace(/badge\/version-[0-9\.]+-blue/g, `badge/version-${targetVersion}-blue`);
});

// 7. docs/index.html
updateFile("docs/index.html", (content) => {
  let updated = content.replace(/v\d+\.\d+\.\d+/g, `v${targetVersion}`);
  updated = updated.replace(/app-release-v\d+\.\d+\.\d+\.apk/g, `app-release-v${targetVersion}.apk`);
  return updated;
});

// 8. package-lock.json
updateFile("package-lock.json", (content) => {
  try {
    const json = JSON.parse(content);
    json.version = targetVersion;
    if (json.packages && json.packages[""]) {
      json.packages[""].version = targetVersion;
    }
    return JSON.stringify(json, null, 2) + "\n";
  } catch {
    return content;
  }
});

console.log(`\n🎉 版本号一键同步完成！成功同步 ${successCount} 个配置文件。`);
