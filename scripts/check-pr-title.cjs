const title = process.env.PR_TITLE?.trim() ?? "";
const conventionalTitle = /^(feat|fix|refactor|docs|test|build|ci|chore|perf|revert)(\([a-z0-9._/-]+\))?!?:\s+\S.+$/u;

if (!conventionalTitle.test(title)) {
  console.error("PR 标题必须使用语义化前缀，例如：feat(agent-runtime): 增加 Tool 审批闭环");
  process.exit(1);
}

console.log(`PR 标题校验通过：${title}`);
