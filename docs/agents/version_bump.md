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
| `Cargo.lock` | workspace 根锁里 `app` 包的锁定版本（cargo 在 workspace 中实际读取的锁文件） |
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

## 四、发布说明与线上分发的同步

每次发版除版本号外，还要把「更新说明」送到三个位置，避免用户升级后不知道改了什么：

1. **标签与 GitHub Release**：用同一份说明写入附注标签（`git tag -a v<version> -F notes-<version>.md`），Release 建好后执行
   `gh release edit v<version> --notes-file notes-<version>.md`。
2. **应用内更新弹窗**：原生客户端读取自有服务器的 `/version.json`，弹窗正文取自其 `message` 字段（多行纯文本）。
   下载统计服务（服务器 `download-tracker`）会在 `notes/<version>.md` 存在时把该文件内容并入 `message`；
   文件不存在则回退为 `Mobile Tavern v<version> · <日期>`。因此发版时把说明文件放到服务器
   `/root/download-tracker/notes/<version>.md` 即可，无需改代码。
3. **线上宣传页**（`/var/www/neural/tavern/index.html`）：这是服务器上单独维护的版本，不由 `bump-version.cjs` 覆盖。
   发版后需手工替换其中的版本文案（下载按钮、hero 徽章、步骤说明、`softwareVersion` 结构化数据），
   并把 `main-<旧版本>.js` 复制为 `main-<新版本>.js` 后修改脚本引用。

固定下载入口始终是 `https://neural-node.xyz/dl/latest`，历史版本保留
`https://neural-node.xyz/dl/mobile-tavern-<version>-release.apk`。
