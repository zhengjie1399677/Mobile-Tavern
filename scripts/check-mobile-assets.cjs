const fs = require("node:fs");
const path = require("node:path");

const workspace = path.resolve(__dirname, "..");
const distDir = path.join(workspace, "dist");

if (!fs.existsSync(distDir)) {
  throw new Error("[移动端产物检查] dist 不存在，请先运行 npm run build:web");
}

const prohibitedNames = new Set([
  "server.cjs",
  "server.cjs.map",
  "server.ts",
]);
const violations = [];

function inspectDirectory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      inspectDirectory(absolutePath);
      continue;
    }
    if (prohibitedNames.has(entry.name)) {
      violations.push(path.relative(workspace, absolutePath));
    }
  }
}

inspectDirectory(distDir);

if (violations.length > 0) {
  throw new Error(
    `[移动端产物检查] 检测到 Node/Express 服务端产物：${violations.join(", ")}`,
  );
}

console.log("[移动端产物检查] 通过：未发现 Node/Express 服务端产物。");
