/**
 * 对本次改动的 TS/TSX 文件执行 ESLint 门禁（仅阻断 error，warning 放行）。
 *
 * 设计意图（对应 docs/agents/code_review.md 第五节"自动化与人工分工"）：
 * - 全仓库 eslint 允许历史债务以 warning 呈现（typescript_discipline.md 既定决策）；
 * - 改动文件必须零 error（--quiet），阻断新增正确性/类型级问题溜进 main；
 * - 历史 warning（未登记 any、未使用变量等）以 --quiet 放行，不强制一次清空，
 *   与 typescript_discipline.md"历史债务以 warning 呈现、新增由架构审查阻止"对齐。
 *   历史债务的渐进清理由文档豁免表登记 + 架构审查跟踪，而非 lint 强制。
 *
 * 用法：
 *   node scripts/lint-changed.cjs            # 默认基准 HEAD：检查工作区未提交改动
 *   node scripts/lint-changed.cjs origin/main # CI：检查与目标分支的差异
 *   node scripts/lint-changed.cjs --staged    # pre-commit：只检查暂存区
 */
const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { dirname, join } = require("node:path");

const args = process.argv.slice(2);
const staged = args.includes("--staged");
const base = args.find((arg) => arg !== "--staged") || "HEAD";

if (!existsSync(".git")) {
  console.error("未找到 .git，请在仓库根目录运行本脚本。");
  process.exit(1);
}

// 变更文件 = 工作区未提交改动 + 与基准分支的差异（去掉已删除文件）
const diff = spawnSync(
  "git",
  staged
    ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR"]
    : ["diff", "--name-only", "--diff-filter=ACMR", base],
  { encoding: "utf8" }
);
if (diff.status !== 0) {
  const detail = typeof diff.stderr === "string"
    ? diff.stderr.trim()
    : diff.error?.message ?? "未知错误";
  console.error(`git diff 失败：${detail}`);
  process.exit(1);
}

let changedOutput = diff.stdout;
if (!staged) {
  const untracked = spawnSync(
    "git",
    ["ls-files", "--others", "--exclude-standard"],
    { encoding: "utf8" },
  );
  if (untracked.status !== 0) {
    const detail = typeof untracked.stderr === "string"
      ? untracked.stderr.trim()
      : untracked.error?.message ?? "未知错误";
    console.error(`git ls-files 失败：${detail}`);
    process.exit(1);
  }
  changedOutput += `\n${untracked.stdout}`;
}

const files = [...new Set(changedOutput
  .split("\n")
  .map((f) => f.trim())
  .filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith("node_modules/")))];

if (files.length === 0) {
  console.log("本次改动无 TypeScript 文件，跳过 ESLint 严格门禁。");
  process.exit(0);
}

console.log(
  staged
    ? `严格门禁检查 ${files.length} 个暂存 TypeScript 文件：`
    : `严格门禁检查 ${files.length} 个改动文件（基准 ${base}）：`,
);
for (const f of files) console.log(`  - ${f}`);

const result = spawnSync(
  process.execPath,
  [join(dirname(require.resolve("eslint/package.json")), "bin", "eslint.js"), ...files, "--quiet"],
  { encoding: "utf8" }
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) console.error(`ESLint 启动失败：${result.error.message}`);

process.exit(result.status ?? 1);
