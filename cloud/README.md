# Mobile Tavern 云端后端

> ⚠️ 本目录为云端后端服务，与移动端 App 物理隔离。详见 [AGENTS.md 准则十一](../AGENTS.md) 与 [云端后端开发规范](../docs/agents/cloud_strategy.md)。

## 定位

为 Mobile Tavern 移动端 App 提供云端配套服务，包括：

- **账号体系**：邮箱注册 + Google OAuth 一键登录 + JWT 签发
- **云端推理**：LLM SSE 网关转发（解决移动端直连 LLM 网络问题）
- **社区分享**：角色卡 / 世界书市场（P3 阶段）
- **遥测移植**：从 Tauri Rust 后端迁移至云端统一落盘
- **热更新**：内容分发 + WebView 资源灰度更新（P4 阶段）

## 技术栈

| 组件 | 选型 | 用途 |
|---|---|---|
| Web 框架 | axum 0.7 + tokio | 异步 HTTP 服务 |
| 数据库 | PostgreSQL 16 + pgvector | 主库 + 语义检索 |
| 缓存/限流 | Redis 7 | JWT 黑名单 + 注册限流 |
| 类型共享 | ts-rs（shared crate） | 前后端契约单一来源 |
| 反向代理 | Caddy（生产）/ docker-compose（开发） | TLS 终止 + 反代 |

## 本地开发

### 前置要求

- Rust 1.77.2+（`rustup default stable`）
- Docker + Docker Compose

### 启动依赖（PG + Redis）

```bash
cd cloud
docker compose up -d postgres redis
```

### 本地运行后端

```bash
cp .env.example .env
# 编辑 .env 填充 DATABASE_URL / REDIS_URL 等
cargo run
```

访问 `http://localhost:8080/health` 验证启动。

### 全栈 Docker 启动

```bash
docker compose up -d --build
```

## 目录结构

```
cloud/
├── Cargo.toml              # 独立 crate 配置
├── Dockerfile              # 多阶段构建（镜像 ~50MB）
├── docker-compose.yml      # 本地开发栈（PG + Redis + 后端）
├── postgres-init/          # PG 初始化脚本（pgvector 扩展）
├── migrations/             # SQLx 数据库迁移
├── .env.example            # 环境变量模板
└── src/
    ├── main.rs             # 入口（日志/路由/优雅停机）
    ├── health.rs           # 健康检查端点
    ├── account/            # P1: 账号体系（邮箱 + Google OAuth + JWT）
    ├── inference/          # P2: LLM 网关
    ├── telemetry/          # P1: 遥测移植
    ├── share/              # P3: 社区分享
    └── update/             # P4: 热更新
```

## 部署

生产部署详见 [部署指南](../docs/cloud_deployment.md)（待补全）。

核心要点：
- 单 `docker compose up -d` 启动全栈
- 生产环境 `JWT_SECRET` 必须替换为强随机串
- `CORS_ALLOWED_ORIGINS` 收紧为实际移动端 Origin
- 使用 Caddy 反代 + 自动 TLS（详见部署指南）

## 与移动端的边界

- 移动端 Tauri 打包**不会包含** `cloud/` 目录任何代码
- 前后端类型共享通过 `shared/` crate 的 ts-rs 自动导出
- 详见 [AGENTS.md 准则三（纯移动端战略）](../AGENTS.md) 与 [准则十一（云端后端开发）](../AGENTS.md)