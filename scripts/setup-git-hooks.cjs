const { chmodSync, existsSync } = require("node:fs");
const { spawnSync } = require("node:child_process");

if (process.env.CI || !existsSync(".git")) {
  process.exit(0);
}

for (const hook of [".githooks/pre-commit", ".githooks/pre-push"]) {
  if (existsSync(hook)) {
    chmodSync(hook, 0o755);
  }
}

const result = spawnSync("git", ["config", "core.hooksPath", ".githooks"], {
  stdio: "inherit",
});

if (result.status !== 0) {
  console.warn("未能自动启用仓库 Git Hooks；请运行 npm run setup:hooks。");
  process.exitCode = result.status ?? 1;
}
