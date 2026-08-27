# 贡献指南 (CONTRIBUTING)

感谢你对 Mobile Tavern 项目的关注！本文档描述了参与本项目开发的基本要求与流程。

## 行为指导手册

**所有贡献者必须首先阅读 [AGENTS.md](AGENTS.md)**。
该文件使用稳定标识定义本项目的核心行为准则，覆盖 `ARCH-KERNEL`、`ARCH-FLOW`、
`COMPAT-DATA`、`PLATFORM-MOBILE`、`CONFIG-TRACKS`、`QUALITY-TYPES`、`CHANGE-SAFE`、
`TEST-CONTROLLED`、`DOC-CHINESE` 和 `COLLAB-IDENTITY`。专项入口见
`docs/agents/architecture_entry.md`，不要使用会随排序变化的数字编号引用规则。

## 开发环境准备

```bash
# 安装依赖
npm install

# 安装 Playwright 浏览器（需配置国内镜像）
set PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright
npm run test:e2e:install
```

## 提交流程

1. **Fork** 仓库并创建特性分支
2. **开发** 遵循 `CHANGE-SAFE`、`TEST-CONTROLLED` 和隔离开发流程：新逻辑在独立文件中编写，禁止侵入无关模块
3. **测试** 按改动范围遵循 [开发与维护工作流](docs/agents/development_workflow.md) 的最低验证要求。涉及核心链路时至少运行：
   ```bash
   npm run lint          # TypeScript 类型检查
   npm run test          # 主集成测试套件
   npm run test:unit     # Vitest 组件渲染测试
   npm run test:zod      # Zod 兼容性测试
   ```
4. **提交** 遵循语义化提交信息：
   - `feat: 新增功能描述`
   - `fix: 修复问题描述`
   - `refactor: 重构描述`
   - `docs: 文档变更描述`
   - `test: 测试变更描述`
5. **Pull Request** 附带变更说明与测试结果，使用 `.github/PULL_REQUEST_TEMPLATE.md` 模板；审查标准与流程见 `docs/agents/code_review.md`

## 代码规范

### TypeScript
- 严格模式（`tsc --noEmit` 必须通过）
- 单文件行数硬上限 **1000 行**（`QUALITY-TYPES`），接近时按职责边界拆分
- 禁止 `any` 类型泄漏

### 架构解耦
- 新功能必须按隔离开发流程设计，先定义边界和失败路径，再接入组合根。
- 核心业务按职责边界拆分，事务流程保持原子性。
- IndexedDB 物理分轨存储：高频大字段分流至独立 store。

### 文档
- 所有项目 Markdown 文档必须使用中文，技术名词、代码标识符、命令和文件名保留原拼写。
- 报告类文档命名格式：`<主题>_<YYYY-MM-DD>.md`

## 版本号同步

修改版本号时必须运行 `npm run bump-version <new_version>`，并在提交前运行
`npm run check:version`；不要手工跨文件替换版本号。
