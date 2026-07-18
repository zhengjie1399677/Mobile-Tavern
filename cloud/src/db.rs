//! PostgreSQL 连接池与迁移管理
//!
//! 设计要点：
//!   1. PgPool 在启动时创建一次，通过 Arc 注入 AppState
//!   2. 连接池参数针对移动端后端的低并发场景调优（max=10 够用）
//!   3. 启动时自动跑迁移（sqlx::migrate!），失败则拒绝启动
//!   4. 健康检查通过 SELECT 1 验证连通性，不依赖业务表

use std::time::Duration;

use sqlx::migrate::MigrateError;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

/// 初始化 PostgreSQL 连接池
///
/// 参数针对云端后端（单实例、低并发）调优：
///   - max_connections=10：足够支撑 100 QPS 量级
///   - min_connections=1：避免完全空闲时无连接
///   - acquire_timeout=30s：容忍 PG 抖动
///   - idle_timeout=10min：空闲连接及时回收
///   - max_lifetime=30min：避免长连接累积状态
pub async fn init_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    tracing::info!("初始化 PostgreSQL 连接池 ...");

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .min_connections(1)
        .acquire_timeout(Duration::from_secs(30))
        .idle_timeout(Duration::from_secs(600))
        .max_lifetime(Duration::from_secs(1800))
        .connect(database_url)
        .await?;

    tracing::info!("PostgreSQL 连接池就绪");
    Ok(pool)
}

/// 启动时自动执行数据库迁移
///
/// `sqlx::migrate!` 宏在编译期读取 `cloud/migrations/` 目录，
/// 将所有 .sql 文件嵌入二进制，运行时按版本号顺序执行。
/// 已执行的迁移通过 _sqlx_migrations 表追踪，不会重复跑。
pub async fn run_migrations(pool: &PgPool) -> Result<(), MigrateError> {
    tracing::info!("执行数据库迁移 ...");
    sqlx::migrate!("./migrations").run(pool).await?;
    tracing::info!("数据库迁移完成");
    Ok(())
}

/// 健康检查：验证 PG 连通性
///
/// 使用 `SELECT 1` 而非业务表查询，避免迁移未执行时误报故障。
pub async fn check_health(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT 1").execute(pool).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 此测试需要真实 PG 实例，仅在 integration 测试中启用
    /// 普通单元测试不依赖外部服务
    #[test]
    fn init_pool_signature_compiles() {
        // 编译期检查：引用函数符号，确保模块装配正确（签名变化时编译失败）
        // 用元组绑定避免 unused 警告，类型推断保留原始 async fn 签名
        let _ = (init_pool, run_migrations, check_health);
    }
}