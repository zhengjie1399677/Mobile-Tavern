//! Mobile Tavern 云端后端入口
//!
//! 职责边界（详见 docs/agents/cloud_strategy.md）：
//!   - account 模块：邮箱注册 + Google OAuth + JWT 签发
//!   - inference 模块：LLM SSE 网关转发
//!   - telemetry 模块：遥测落盘（从 Tauri Rust 后端移植）
//!   - share 模块：角色卡 / 世界书社区市场
//!   - update 模块：内容分发 + WebView 资源灰度更新
//!
//! 部署形态：Docker 容器化，与移动端 App 物理隔离（见 AGENTS.md 准则十一）。

use std::net::SocketAddr;

use axum::{routing::get, Router};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

mod config;
mod db;
mod error;
mod health;
mod redis;
mod state;

use config::AppConfig;
use state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 初始化日志：支持 RUST_LOG 环境变量，默认 info 级别
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(tracing_subscriber::fmt::layer().with_target(false))
        .init();

    // 加载 .env（开发期用，生产环境通过容器环境变量注入）
    dotenvy::dotenv().ok();
    tracing::info!("Mobile Tavern 云端后端启动中…");

    // 加载应用配置（fail-fast：必填变量缺失直接退出）
    let cfg = AppConfig::from_env()?;
    tracing::info!(
        db_url = %cfg.database_url,
        redis_url = %cfg.redis_url,
        port = cfg.port,
        cors_origins = ?cfg.cors_allowed_origins,
        google_oauth_enabled = cfg.google_client_id.is_some(),
        smtp_enabled = cfg.smtp_host.is_some(),
        "配置加载完成"
    );

    // 初始化 PostgreSQL 连接池
    let pool = db::init_pool(&cfg.database_url).await?;

    // 启动时自动执行数据库迁移（失败则拒绝启动）
    db::run_migrations(&pool).await?;

    // 初始化 Redis 连接管理器
    let redis_manager = redis::init_manager(&cfg.redis_url).await?;

    // 装配 AppState
    let state = AppState::new(pool, redis_manager, cfg.clone());

    // CORS：使用配置中的白名单，生产环境必须收紧
    let cors_layer = if cfg.cors_allowed_origins.is_empty() {
        tracing::warn!("CORS_ALLOWED_ORIGINS 未配置，使用 permissive 模式（仅开发环境）");
        CorsLayer::permissive()
    } else {
        CorsLayer::new()
            .allow_origin(AllowOrigin::list(
                cfg.cors_allowed_origins
                    .iter()
                    .filter_map(|o| o.parse().ok()),
            ))
            .allow_methods([
                axum::http::Method::GET,
                axum::http::Method::POST,
                axum::http::Method::PUT,
                axum::http::Method::PATCH,
                axum::http::Method::DELETE,
                axum::http::Method::OPTIONS,
            ])
            .allow_headers([
                axum::http::header::AUTHORIZATION,
                axum::http::header::CONTENT_TYPE,
            ])
            .allow_credentials(true)
    };

    // TODO: P1.2 在此装配 account 模块路由
    // TODO: P1.4 在此装配 telemetry 模块路由

    let app = Router::new()
        .route("/health", get(health::health_check))
        .route("/health/deep", get(health::deep_health_check))
        .layer(cors_layer)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], cfg.port));
    tracing::info!(%addr, "HTTP 服务监听启动");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    tracing::info!("服务已优雅退出");
    Ok(())
}

/// 优雅停机：捕获 SIGTERM / SIGINT，确保进行中的请求处理完成
async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("停机信号收到，开始优雅退出…");
}