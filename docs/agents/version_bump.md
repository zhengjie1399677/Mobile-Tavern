# 应用发布版本号同步修改与一键命令规范

> [!IMPORTANT]
> **此文件为 Mobile Tavern 行为指导手册的子规范，定义了版本号一键同步命令及其影响的物理文件映射。**

---

### 一键同步命令

当需要更新或升级客户端 App 的整体发布版本号（例如从 1.6.1 升级到 1.7.0）时，前端及本地服务代码已实现变量化（直接引用 `__APP_VERSION__` / `package.json`）。对于跨语言构建及文档配置文件，必须优先使用内置的一键同步脚本：

```bash
npm run bump-version <new_version>   # 示例：npm run bump-version 1.7.0
```

该命令会自动精确更新以下物理文件，**严禁执行耗费 Token 的全盘目录扫描与手动逐文件替换**：

### 1. 核心构建与配置文件（脚本自动同步）
*   **Vite 前端主配置**：修改 `package.json` 中的 `"version"` 字段。
*   **Tauri 构建配置**：修改 `src-tauri/tauri.conf.json` 中的 `"version"` 字段。
*   **Rust 后端配置**：修改 `src-tauri/Cargo.toml` 中的 `version` 字段。
*   **Aliyun FC Serverless 配置**：修改 `serverless/aliyun-fc-sts/package.json` 中的 `"version"` 字段。

### 2. 运行时与服务层版本定义（已变量化/自动读取）
*   **Vite 全局常量**：在 `vite.config.ts` 中注入 `__APP_VERSION__`，读取 `package.json` 的 `version`，前端代码统一使用变量。
*   **本地 Express 服务端**：`server.ts` 中的端点（如 `/api/check-update`、`/version`）自动从 `package.json` 动态读取。
*   **客户端静态版本文件**：修改 `public/version` 文件中的 `"pkgVersion"` 键值（脚本自动同步）。

### 3. 说明文档与演示网页（脚本自动同步）
*   **README 项目徽章**：修改 `README.md` 头部的 `badge/version-...` 徽章标识。
*   **官方展示/下载网页**：修改 `docs/index.html` 中涉及版本号的声明与下载按钮。

### 4. 依赖锁定文件（自动同步）
*   **npm 锁定文件**：修改 `package-lock.json` 中的顶层 `"version"` 键值。
