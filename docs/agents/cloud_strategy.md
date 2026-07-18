# 云端后端开发与移动端物理隔离规范

> [!IMPORTANT]
> **此文件为 Mobile Tavern 行为指导手册的子规范，定义了云端后端服务的目录隔离、类型共享、Docker 化部署与合规边界。**
> 任何涉及云端后端的开发必须首先遵守本规范。

---

### 1. 定位与职责边界

云端后端（`cloud/` 目录）为移动端 App 提供以下配套服务，**不承担移动端运行时职责**：

| 模块 | 职责 | 落地阶段 |
|---|---|---|
| `account` | 邮箱注册 + Google OAuth + JWT 签发 | P1 |
| `telemetry` | 遥测落盘（从 Tauri Rust 后端移植） | P1 |
| `inference` | LLM SSE 网关转发 | P2 |
| `share` | 角色卡 / 世界书社区市场 | P3 |
| `update` | 内容分发 + WebView 资源灰度更新 | P4 |

**目标市场**：海外用户 + 国内翻墙用户（不提供国内合规登录方式，不申请微信/QQ/运营商 SDK）。

### 2. 物理隔离铁律

*   **目录隔离**：云端代码**仅限** `cloud/` 与 `shared/` 两个顶层目录，严禁侵入 `src/`（移动端前端）或 `src-tauri/`（移动端 Rust 后端）。
*   **打包隔离**：Tauri 移动端打包（`npm run tauri build`）**不会包含** `cloud/` 任何代码。移动端 App 仍是纯原生混合应用，符合准则三。
*   **依赖隔离**：`cloud/Cargo.toml` 与 `src-tauri/Cargo.toml` 各自独立声明依赖。workspace 层仅共享 `serde` / `serde_json` / `chrono` 三个基础 crate，其余依赖互不影响。
*   **开发隔离**：云端开发遵循准则八物理隔离流程，新增模块限在 `cloud/src/<module>/` 内读写，通过 `cloud/src/main.rs` 装配路由。

### 3. 类型共享机制（ts-rs）

前后端契约的**单一来源**是 `shared/` crate 中的 Rust 类型定义。

*   **导出机制**：在 `shared/src/*.rs` 的结构体上加 `#[derive(ts_rs::TS)]` 和 `#[ts(export, export_to = "../bindings/")]`，`cargo build -p shared` 时自动生成 `.ts` 文件到 `shared/bindings/`。
*   **前端导入**：在 `tsconfig.json` 中配置 path alias `@cloud-types/*` → `./shared/bindings/*`，前端 `import { User } from "@cloud-types/account"`。
*   **修改流程**：改 Rust 类型 → `cargo build -p shared` → 前端类型自动更新。**严禁**手改 `shared/bindings/` 下的生成文件。
*   **入 Git**：生成的 `.ts` 文件入版本控制，避免前端开发者必须跑 cargo 才能拿到类型。

### 4. Docker 化部署规范

*   **多阶段构建**：`cloud/Dockerfile` 必须使用 builder + runtime 两阶段，最终镜像 ≤ 60MB。
*   **非 root 运行**：镜像内创建 `tavern` 系统用户，以非 root 身份运行二进制。
*   **健康检查**：暴露 `/health` 端点供 Docker / 负载均衡器探活。
*   **本地开发栈**：`cloud/docker-compose.yml` 一键启动 PG + Redis + 后端，生产部署复制为 `docker-compose.prod.yml` 并移除端口映射。
*   **环境变量**：所有配置通过环境变量注入，`.env.example` 为模板。生产环境的 `JWT_SECRET` 必须替换为强随机串（≥ 32 字节）。

### 5. 数据隔离与合规要求

*   **用户数据隔离**：所有业务表（messages / sessions / cards 等）必须带 `user_id` 字段，查询时强制过滤。推荐使用 PostgreSQL RLS（Row Level Security）在数据库层兜底。
*   **GDPR / CCPA 合规**：必须提供账号删除入口（`DELETE /account`），30 天内彻底清除该用户所有业务数据，并同步撤销 Google OAuth 授权。
*   **数据最小化**：Google OAuth 仅申请 `openid` + `email` + `profile` 三个非敏感 scope，严禁申请多余权限。
*   **密码存储**：邮箱用户密码使用 `argon2` 哈希，严禁明文或弱哈希（MD5/SHA1）。
*   **JWT 安全**：access token 短期（24h），refresh token 长期（30d），refresh token 支持轮换与吊销（Redis 黑名单）。

### 6. 与移动端的边界

*   **网络通信**：移动端通过 Tauri HTTP 原生直连云端 API（绕过 WebView CORS），请求头携带 JWT。
*   **离线优先**：移动端本地 IndexedDB 仍是主数据源，云端为可选增强（同步/备份/社区）。无网络时 App 核心功能不受影响。
*   **数据同步**：本地 → 云端首次迁移逻辑由移动端发起，云端提供批量写入 endpoint。冲突解决策略待 P1 设计阶段细化。
*   **错误降级**：云端不可达时，移动端必须优雅降级（本地模式运行），严禁因云端故障导致 App 白屏。

### 7. 开发流程

1.  **新增模块**：在 `cloud/src/<module>/` 下创建目录，通过 `cloud/src/main.rs` 装配路由。
2.  **类型变更**：修改 `shared/src/*.rs` → `cargo build -p shared` → 前端类型自动更新。
3.  **数据库迁移**：在 `cloud/migrations/` 下用 `sqlx migrate add -r <name>` 生成可回滚迁移脚本。
4.  **本地验证**：`docker compose up -d postgres redis` 启动依赖 → `cargo run` 启动后端 → 访问 `http://localhost:8080/health`。
5.  **全栈验证**：`docker compose up -d --build` 启动完整栈。

### 8. 部署规范

*   **服务器选型**：海外 VPS（RackNerd / BandwagonHost / Hetzner），支持支付宝或虚拟卡支付。
*   **反向代理**：Caddy 自动 TLS + 反代，配置极简。生产环境收紧 CORS 白名单为实际移动端 Origin。
*   **数据库扩展**：PostgreSQL 启用 `pgvector` 扩展（P3 社区分享阶段用于语义检索）。
*   **备份**：PG 数据每日自动备份到对象存储（OSS / S3 / R2），保留 7 天滚动。
*   **监控**：`/health` 端点接入 UptimeRobot 或类似服务，故障告警。
