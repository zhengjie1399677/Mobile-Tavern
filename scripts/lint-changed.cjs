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
 */
const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");

const base = process.argv[2] || "HEAD";

if (!existsSync(".git")) {
  console.error("未找到 .git，请在仓库根目录运行本脚本。");
  process.exit(1);
}

// 变更文件 = 工作区未提交改动 + 与基准分支的差异（去掉已删除文件）
const diff = spawnSync(
  "git",
  ["diff", "--name-only", "--diff-filter=ACMR", base],
  { encoding: "utf8" }
);
if (diff.status !== 0) {
  console.error(`git diff 失败：${diff.stderr.trim()}`);
  process.exit(1);
}

const files = diff.stdout
  .split("\n")
  .map((f) => f.trim())
  .filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith("node_modules/"));

if (files.length === 0) {
  console.log("本次改动无 TypeScript 文件，跳过 ESLint 严格门禁。");
  process.exit(0);
}

console.log(`严格门禁检查 ${files.length} 个改动文件（基准 ${base}）：`);
for (const f of files) console.log(`  - ${f}`);

const result = spawnSync(
  "npx",
  ["eslint", ...files, "--quiet"],
  { encoding: "utf8", stdio: "inherit", shell: process.platform === "win32" }
);

process.exit(result.status ?? 1);
