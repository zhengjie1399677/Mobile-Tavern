//! 应用共享状态
//!
//! AppState 通过 axum::extract::State 注入到所有 handler，
//! 内部所有字段都是 Clone 廉价的（PgPool / ConnectionManager 内部均 Arc）。

use std::sync::Arc;

use redis::aio::ConnectionManager;
use sqlx::PgPool;

use crate::config::AppConfig;

#[derive(Clone)]
pub struct AppState {
    /// PostgreSQL 连接池
    pub pool: PgPool,

    /// Redis 连接管理器（单连接 + 自动重连，Clone 廉价）
    pub redis: ConnectionManager,

    /// 应用配置（Arc 共享，运行期只读）
    pub config: Arc<AppConfig>,
}

impl AppState {
    pub fn new(pool: PgPool, redis: ConnectionManager, config: AppConfig) -> Self {
        Self {
            pool,
            redis,
            config: Arc::new(config),
        }
    }
}
