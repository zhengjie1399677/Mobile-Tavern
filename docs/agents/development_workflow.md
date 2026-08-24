# 开发与维护工作流

> 本文只在修改代码、运行开发服务、选择测试或维护项目文档时按需读取。

## 一、测试选择

| 改动范围 | 最低验证 |
|---|---|
| 仅文档或注释 | `git diff --check`，并检查 Markdown 链接 |
| 单个纯函数、组件或 Hook | 命中测试；必要时追加 `npm run test:unit` |
| 聊天、存储、重发、分页 | 命中回归测试 + `npm test` |
| Kernel、依赖边界、类型契约 | `npm run lint` + `npm test` |
| 打包、Tauri、生产路径 | `npm run lint` + `npm test` + `npm run build` |
| 云端 Rust 服务 | 所属 crate 的 `cargo test`；涉及容器时再验证 Docker 配置 |

测试输出中的预期错误日志不等于测试失败，以退出码和汇总结果为准。测试生成的包、快照或构建产物不得混入提交。

`npm run quality:push` 使用 fail-fast 模式：自定义测试与 Vitest 均在首个失败后停止，且整条门禁由
watchdog 设置 10 分钟硬上限。超时会先终止完整进程树，再在仓库根目录生成被 Git 忽略的
`watchdog-report.json`；诊断与参数说明以 `docs/watchdog-run.md` 为准。

## 二、开发服务与网络

1. 启动或重启 Express/Vite 前，先检查并终止占用目标端口的残留进程；默认端口为 `3000`。
2. Android 热重载绑定 `127.0.0.1`，按 Android 指南配置 `3000` 与 `24678` 反向映射。
3. 开发者常用 TUN 代理；自动化测试不得依赖外部 CDN，应设置有限超时和重试。
4. 浏览器自动化的额外限制见 `docs/agents/browser_testing.md`。

## 三、隔离开发与接入

- 新服务、中间件或插件先在职责明确的文件和局部测试中实现，再修改应用组合根。
- 初始局部验证通过后，才允许进行必要的注册、导出、类型契约和回归测试修改。
- 不得以“物理隔离”为理由留下无法接入、无法验证或重复实现的孤岛代码。
- 详细流程见 `docs/agents/isolation_development.md`。

## 四、文档维护

1. `TODO.md` 只保留未完成事项、必要依赖和最近五条完成摘要；单项原则上不超过六行。
2. 完成功能后，在 `docs/history/TODO_ARCHIVE_2026.md` 追加一行索引，不把实现流水留在 `TODO.md`。
3. 重大功能或修复在当月 `docs/history/CHANGELOG_YYYY-MM.md` 追加一行，说明结果、边界和验证结论。
4. 架构职责与长期数据流进入 `TECHNICAL.md` 或专项规范；当前主线、风险和下一步进入 `CURRENT_STATE.md`。
5. 用户可见入口变化时更新 `README.md`；历史归档不属于默认阅读包。
6. 文档不得固化容易过时的测试数量、文件行数或服务数量，除非它们由自动化同步。

## 五、发布版本

更新 App 版本号时必须运行：

```powershell
npm run bump-version <new_version>
```

也可使用 `patch`、`minor`、`major` 自动递增；提交前运行 `npm run check:version` 校验全部版本来源。禁止手工逐文件替换，完整映射与发布门禁见 `docs/agents/version_bump.md`。
