# 应用发布版本同步规范

> [!IMPORTANT]
> 本文是 Mobile Tavern 版本号修改的唯一权威映射。版本号必须通过脚本同步，禁止手工跨文件替换。

## 一、常用命令

指定版本：

```powershell
npm run bump-version 1.9.0
```

按语义化版本递增：

```powershell
npm run bump-version patch
npm run bump-version minor
npm run bump-version major
```

只预览变更或检查当前一致性：

```powershell
npm run bump-version patch -- --dry-run
npm run check:version
```

脚本会先读取并校验全部版本来源，再统一写入；缺文件、格式异常或定位不到目标字段时会失败，已写入内容会回滚，禁止留下部分同步状态。

## 二、脚本管理的版本来源

| 文件 | 字段或展示位置 |
|---|---|
| `package.json` | 根包 `version`，也是前端与本地服务的运行时基准 |
| `package-lock.json` | 顶层 `version` 与 `packages[""]` 根包版本 |
| `src-tauri/tauri.conf.json` | Tauri `version` |
| `src-tauri/Cargo.toml` | `[package]` 的 `version` |
| `src-tauri/Cargo.lock` | `app` 包的锁定版本 |
| `public/version` | `pkgVersion` |
| `README.md` | 版本徽章 |
| `docs/index.html` | 页面版本标签与 Android 下载按钮文本 |

`vite.config.ts` 注入的 `__APP_VERSION__` 与 `server.ts` 的版本接口均从 `package.json` 读取，不单独维护版本常量。发布 APK 使用 `releases/latest/download/MobileTavern.apk` 固定入口，文件名不再包含版本号。

## 三、发布门禁

普通代码推送继续运行 `npm run quality:push`。只有 Git Hook 能证明待推送提交与 `bump-version.cjs` 从其父提交生成的结果完全一致时，才降级为 `npm run quality:release`；若同时或单独推送标签，标签还必须是对应的 `v<version>`。这可避免在同一份已验证代码上重复执行完整测试与 Web 构建。

任何新分支、混合提交、强制推送、非标准提交标题或无法确认的引用都会自动回退到完整门禁。标准版本提交标题为：

```text
chore(release): bump version to 1.9.0
```

GitHub 的 `v*` 标签仍会触发 Android 构建与 Release 发布；轻量本地门禁不替代远端打包。
