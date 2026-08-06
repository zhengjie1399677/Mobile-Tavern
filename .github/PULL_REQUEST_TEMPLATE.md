---
name: 代码变更
about: 提交代码变更（功能、修复、重构、杂项）
title: "feat: 一句话概括变更"
labels: []
assignees: []
---

## 变更内容

- 概述本次变更做什么（1~3 句）

## 原因与背景

- 为什么需要这次变更？（关联 Issue：#数字 / 缺陷现象 / 用户诉求）

## 改动范围

- [ ] 前端（`src/`）
- [ ] 移动端 / Tauri（`src-tauri/`）
- [ ] 云端服务（`cloud/`）
- [ ] 共享契约（`shared/`）
- [ ] 文档（`docs/`、`AGENTS.md` 等）
- [ ] 构建 / CI / 脚本

## 自测记录（按 docs/agents/development_workflow.md 测试选择矩阵）

- [ ] `npm run lint`（类型检查）通过
- [ ] `npm test` 相关套件通过（列出命中的测试名）
- [ ] `npm run build` 通过（涉及构建路径时）
- [ ] `npm run test:e2e` 通过（涉及浏览器交互时）
- [ ] 专项：`check:i18n` / `verify:preset-samples` / `check:mobile-assets` / `cargo test`（按需勾选）
- [ ] 手动验证场景说明（可复现步骤）

## 架构影响（涉及边界时必填）

- 触及的规则标识（`ARCH-KERNEL` / `ARCH-FLOW` / `COMPAT-DATA` / `PLATFORM-MOBILE` / `CONFIG-TRACKS` / `QUALITY-TYPES` / `CHANGE-SAFE` 等）：
- 迁移 / 降级方案（若有数据或契约变更）：
- 是否同步更新了权威文档：

## 审查提示（写给审查人）

- 最需要重点看的部分与理由：
- 已知取舍与遗留问题：
