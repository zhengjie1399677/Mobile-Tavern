/**
 * 应用发布版本同步工具。
 *
 * 用法：
 *   npm run bump-version 1.9.0
 *   npm run bump-version patch
 *   npm run bump-version minor -- --dry-run
 *   npm run check:version
 */

const fs = require("node:fs");
const path = require("node:path");

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MANAGED_VERSION_FILES = Object.freeze([
  "package.json",
  "package-lock.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "public/version",
  "README.md",
  "docs/index.html",
]);

function parseJson(content, filePath) {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`${filePath} 不是合法 JSON：${error.message}`);
  }
}

function serializeJson(value, originalContent) {
  const lineEnding = originalContent.includes("\r\n") ? "\r\n" : "\n";
  const finalLineEnding = /\r?\n$/.test(originalContent) ? lineEnding : "";
  return JSON.stringify(value, null, 2).replace(/\n/g, lineEnding) + finalLineEnding;
}

function assertVersion(version, source) {
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`${source} 不是合法的三段式语义化版本号：${version}`);
  }
  return version;
}

function replaceRequired(content, pattern, replacement, filePath, description) {
  const matches = content.match(pattern);
  if (!matches || matches.length === 0) {
    throw new Error(`${filePath} 中未找到${description}`);
  }
  return content.replace(pattern, replacement);
}

function updatePackageJson(content, targetVersion) {
  const json = parseJson(content, "package.json");
  json.version = targetVersion;
  return serializeJson(json, content);
}

function updatePackageLock(content, targetVersion) {
  const json = parseJson(content, "package-lock.json");
  if (!json.packages || !json.packages[""]) {
    throw new Error('package-lock.json 缺少 packages[""] 根包记录');
  }
  json.version = targetVersion;
  json.packages[""].version = targetVersion;
  return serializeJson(json, content);
}

function updateTauriConfig(content, targetVersion) {
  const json = parseJson(content, "src-tauri/tauri.conf.json");
  json.version = targetVersion;
  return serializeJson(json, content);
}

function updateCargoManifest(content, targetVersion) {
  return replaceRequired(
    content,
    /(\[package\][\s\S]*?^version\s*=\s*")[^"]+("\s*$)/m,
    `$1${targetVersion}$2`,
    "src-tauri/Cargo.toml",
    "[package] version",
  );
}

function updateCargoLock(content, targetVersion) {
  return replaceRequired(
    content,
    /(\[\[package\]\]\r?\nname = "app"\r?\nversion = ")[^"]+("\r?$)/m,
    `$1${targetVersion}$2`,
    "src-tauri/Cargo.lock",
    'name = "app" 的锁定版本',
  );
}

function updatePublicVersion(content, targetVersion) {
  const json = parseJson(content, "public/version");
  json.pkgVersion = targetVersion;
  return serializeJson(json, content);
}

function updateReadme(content, targetVersion) {
  return replaceRequired(
    content,
    /badge\/version-\d+\.\d+\.\d+-blue/g,
    `badge/version-${targetVersion}-blue`,
    "README.md",
    "版本徽章",
  );
}

function updateDownloadPage(content, targetVersion) {
  const badgeUpdated = replaceRequired(
    content,
    /(?<=>)v\d+\.\d+\.\d+(?=<\/span>)/g,
    `v${targetVersion}`,
    "docs/index.html",
    "版本标签",
  );
  return replaceRequired(
    badgeUpdated,
    /(下载 Android APK \(v)\d+\.\d+\.\d+(\))/g,
    `$1${targetVersion}$2`,
    "docs/index.html",
    "带版本号的下载按钮",
  );
}

const VERSION_UPDATERS = Object.freeze({
  "package.json": updatePackageJson,
  "package-lock.json": updatePackageLock,
  "src-tauri/tauri.conf.json": updateTauriConfig,
  "src-tauri/Cargo.toml": updateCargoManifest,
  "src-tauri/Cargo.lock": updateCargoLock,
  "public/version": updatePublicVersion,
  "README.md": updateReadme,
  "docs/index.html": updateDownloadPage,
});

function buildVersionUpdates(contents, targetVersion) {
  assertVersion(targetVersion, "目标版本");
  const updates = new Map();

  for (const filePath of MANAGED_VERSION_FILES) {
    if (!contents.has(filePath)) {
      throw new Error(`缺少版本来源文件：${filePath}`);
    }
    updates.set(filePath, VERSION_UPDATERS[filePath](contents.get(filePath), targetVersion));
  }

  return updates;
}

function readManagedContents(rootDir) {
  const contents = new Map();
  for (const filePath of MANAGED_VERSION_FILES) {
    const absolutePath = path.join(rootDir, filePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`缺少版本来源文件：${filePath}`);
    }
    contents.set(filePath, fs.readFileSync(absolutePath, "utf8"));
  }
  return contents;
}

function getCurrentVersion(contents) {
  const packageJson = parseJson(contents.get("package.json"), "package.json");
  return assertVersion(String(packageJson.version ?? ""), "package.json version");
}

function incrementVersion(currentVersion, releaseType) {
  const parts = currentVersion.split(".").map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) {
    throw new Error(`当前版本号超出安全整数范围：${currentVersion}`);
  }

  if (releaseType === "major") return `${parts[0] + 1}.0.0`;
  if (releaseType === "minor") return `${parts[0]}.${parts[1] + 1}.0`;
  if (releaseType === "patch") return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  throw new Error(`不支持的版本增量：${releaseType}`);
}

function writeUpdates(rootDir, originalContents, updates) {
  const changedFiles = MANAGED_VERSION_FILES.filter(
    (filePath) => originalContents.get(filePath) !== updates.get(filePath),
  );
  const writtenFiles = [];

  try {
    for (const filePath of changedFiles) {
      fs.writeFileSync(path.join(rootDir, filePath), updates.get(filePath), "utf8");
      writtenFiles.push(filePath);
    }
  } catch (error) {
    for (const filePath of writtenFiles.reverse()) {
      fs.writeFileSync(path.join(rootDir, filePath), originalContents.get(filePath), "utf8");
    }
    throw new Error(`写入失败，已回滚本次版本修改：${error.message}`);
  }

  return changedFiles;
}

function parseArguments(argv) {
  const flags = new Set(argv.filter((argument) => argument.startsWith("--")));
  const positional = argv.filter((argument) => !argument.startsWith("--"));
  const supportedFlags = new Set(["--check", "--dry-run"]);
  const unknownFlag = [...flags].find((flag) => !supportedFlags.has(flag));
  if (unknownFlag) throw new Error(`不支持的参数：${unknownFlag}`);
  if (flags.has("--check") && (flags.has("--dry-run") || positional.length > 0)) {
    throw new Error("--check 不能与目标版本或 --dry-run 同时使用");
  }
  if (!flags.has("--check") && positional.length !== 1) {
    throw new Error("请提供目标版本，或使用 patch、minor、major");
  }
  return {
    checkOnly: flags.has("--check"),
    dryRun: flags.has("--dry-run"),
    requestedVersion: positional[0],
  };
}

function run(argv = process.argv.slice(2), rootDir = path.resolve(__dirname, "..")) {
  const options = parseArguments(argv);
  const contents = readManagedContents(rootDir);
  const currentVersion = getCurrentVersion(contents);
  const targetVersion = options.checkOnly
    ? currentVersion
    : ["major", "minor", "patch"].includes(options.requestedVersion)
      ? incrementVersion(currentVersion, options.requestedVersion)
      : assertVersion(options.requestedVersion, "目标版本");
  const updates = buildVersionUpdates(contents, targetVersion);
  const changedFiles = MANAGED_VERSION_FILES.filter(
    (filePath) => contents.get(filePath) !== updates.get(filePath),
  );

  if (options.checkOnly) {
    if (changedFiles.length > 0) {
      throw new Error(`版本来源不一致（基准 v${currentVersion}）：${changedFiles.join("、")}`);
    }
    console.log(`版本来源一致：v${currentVersion}（${MANAGED_VERSION_FILES.length} 个文件）`);
    return;
  }

  if (options.dryRun) {
    console.log(`试运行：v${currentVersion} -> v${targetVersion}`);
    console.log(changedFiles.length > 0 ? changedFiles.join("\n") : "无需修改");
    return;
  }

  const writtenFiles = writeUpdates(rootDir, contents, updates);
  console.log(`版本同步完成：v${currentVersion} -> v${targetVersion}`);
  console.log(writtenFiles.length > 0 ? writtenFiles.join("\n") : "无需修改");
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(`版本同步失败：${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  MANAGED_VERSION_FILES,
  buildVersionUpdates,
  getCurrentVersion,
  readManagedContents,
  run,
};
