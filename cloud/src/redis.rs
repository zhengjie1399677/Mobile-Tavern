//! Redis 连接管理
//!
//! 设计要点：
//!   1. 使用 redis::aio::ConnectionManager（单连接 + 自动重连 + 内部 Arc 可 Clone）
//!   2. 适合低并发场景（JWT 黑名单 / 限流），未来若需连接池可换 deadpool-redis
//!   3. 健康检查用 PING 命令，不依赖业务 key
//!   4. 不在此处封装业务操作（SET/GET），具体用法在 account/jwt.rs 等模块就近实现

use redis::aio::ConnectionManager;
use redis::Client;

/// 初始化 Redis ConnectionManager
///
/// ConnectionManager 内部维护单连接，断线自动重连。
/// 通过 `Clone` 即可在多个 handler 间共享（内部 Arc）。
pub async fn init_manager(redis_url: &str) -> Result<ConnectionManager, redis::RedisError> {
    tracing::info!("初始化 Redis 连接 ...");

    let client = Client::open(redis_url)?;
    let manager = ConnectionManager::new(client).await?;

    tracing::info!("Redis 连接就绪");
    Ok(manager)
}

/// 健康检查：PING Redis
pub async fn check_health(conn: &mut ConnectionManager) -> Result<(), redis::RedisError> {
    redis::cmd("PING")
        .query_async::<String>(conn)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_manager_signature_compiles() {
        // 编译期检查：引用函数符号，确保模块装配正确（签名变化时编译失败）
        // 用元组绑定避免 unused 警告，类型推断保留原始 async fn 签名
        let _ = (init_manager, check_health);
    }
}