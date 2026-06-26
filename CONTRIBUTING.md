# 贡献指南 (CONTRIBUTING)

感谢你对 Mobile Tavern 项目的关注！本文档描述了参与本项目开发的基本要求与流程。

## 行为指导手册

**所有贡献者必须首先阅读 [AGENTS.md](file:///d:/projects/Mobile-Tavern/AGENTS.md)**。
该文件定义了本项目的 10 条核心行为准则，包括：
- 准则一：超大规模扩展性与极致底座解耦战略
- 准则二：SillyTavern 生态兼容与底层原则（纯数据驱动，零硬编码）
- 准则三：纯移动端战略与原生适配规范
- 准则四：受控浏览器自动化测试规范
- 准则五：Markdown 文档编写全中文规范
- 准则六：应用发布版本号同步修改规范
- 准则七：新指令与既有指导手册冲突处理原则
- 准则八：AI 协作物理隔离开发铁律
- 准则十：AI 协作物理隔离开发实操流程（TDD 单兵测试驱动）

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
2. **开发** 遵循物理隔离开发铁律（准则八/十）：新逻辑在独立文件中编写，禁止侵入无关模块
3. **测试** 必须通过以下全部验证：
   ```bash
   npm run lint          # TypeScript 类型检查
   npm run test          # 主集成测试套件（41 函数）
   npm run test:unit     # Vitest 组件渲染测试
   npm run test:zod      # Zod 兼容性测试
   ```
4. **提交** 遵循语义化提交信息：
   - `feat: 新增功能描述`
   - `fix: 修复问题描述`
   - `refactor: 重构描述`
   - `docs: 文档变更描述`
   - `test: 测试变更描述`
5. **Pull Request** 附带变更说明与测试结果

## 代码规范

### TypeScript
- 严格模式（`tsc --noEmit` 必须通过）
- 单文件行数硬上限 **1000 行**（准则一.6），接近时按职责边界拆分
- 禁止 `any` 类型泄漏

### 架构解耦
- 新功能必须按微服务/插件解耦标准设计（准则一.6）
- 核心业务从上帝 Hook 中解耦，下沉到独立的切面微服务
- IndexedDB 物理分轨存储：高频大字段分流至独立 store

### 文档
- 所有 Markdown 文档必须**全中文**书写（准则五），技术名词保留英文
- 报告类文档命名格式：`<主题>_<YYYY-MM-DD>.md`

## 版本号同步

修改版本号时，必须同步更新 AGENTS.md 准则六列出的 7 处物理位置。
