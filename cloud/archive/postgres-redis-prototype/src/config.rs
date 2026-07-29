//! 应用配置：从 .env / 环境变量加载
//!
//! 设计要点：
//!   1. dotenvy::dotenv() 在 main 入口调用一次，此处只负责读取
//!   2. 必填变量缺失直接 panic（fail-fast），避免运行时才暴露配置错误
//!   3. 所有默认值集中在此处，便于审计与文档化
//!   4. CORS 白名单解析为 Vec<String>，运行时直接注入 CorsLayer

use std::env;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("缺少必填环境变量: {0}")]
    Missing(&'static str),
    #[error("环境变量 {0} 的值无效: {1}")]
    Invalid(&'static str, String),
}

/// 应用全局配置
///
/// 所有字段在启动时一次性确定，运行期不可变。
/// 通过 `Arc<AppConfig>` 注入 AppState 供 handler 共享读取。
#[derive(Debug, Clone)]
pub struct AppConfig {
    /// PostgreSQL 连接串，例：postgres://user:pass@host:5432/db
    pub database_url: String,

    /// Redis 连接串，例：redis://host:6379
    pub redis_url: String,

    /// HTTP 监听端口
    pub port: u16,

    /// tracing 过滤指令，例：info,mobile_tavern_cloud=debug
    pub rust_log: String,

    /// JWT 签名密钥（HS256）。生产环境必须为强随机串（>=32 字节）
    pub jwt_secret: String,

    /// Access Token 有效期（小时）
    pub jwt_expires_hours: i64,

    /// Refresh Token 有效期（天）
    pub jwt_refresh_expires_days: i64,

    /// Google OAuth Client ID（P1.3 账号体系使用，未配置时禁用 Google 登录）
    pub google_client_id: Option<String>,

    /// SMTP 主机（P1.5 邮箱验证使用，未配置时跳过发送验证邮件）
    pub smtp_host: Option<String>,
    pub smtp_port: Option<u16>,
    pub smtp_user: Option<String>,
    pub smtp_pass: Option<String>,
    pub smtp_from: Option<String>,

    /// CORS 允许的 Origin 列表
    pub cors_allowed_origins: Vec<String>,
}

impl AppConfig {
    /// 从环境变量加载配置
    ///
    /// 调用前应先 `dotenvy::dotenv().ok()`，本函数不重复加载 .env。
    pub fn from_env() -> Result<Self, ConfigError> {
        let database_url = env::var("DATABASE_URL")
            .map_err(|_| ConfigError::Missing("DATABASE_URL"))?;

        let redis_url = env::var("REDIS_URL")
            .map_err(|_| ConfigError::Missing("REDIS_URL"))?;

        let port = env::var("PORT")
            .unwrap_or_else(|_| "8080".to_string())
            .parse::<u16>()
            .map_err(|e| ConfigError::Invalid("PORT", e.to_string()))?;

        let rust_log = env::var("RUST_LOG")
            .unwrap_or_else(|_| "info,mobile_tavern_cloud=debug".to_string());

        let jwt_secret = env::var("JWT_SECRET")
            .map_err(|_| ConfigError::Missing("JWT_SECRET"))?;

        // 启动期警告：生产环境密钥过短
        if jwt_secret.len() < 32 {
            tracing::warn!(
                len = jwt_secret.len(),
                "JWT_SECRET 长度不足 32 字节，生产环境存在被爆破风险"
            );
        }

        let jwt_expires_hours = env::var("JWT_EXPIRES_HOURS")
            .unwrap_or_else(|_| "24".to_string())
            .parse::<i64>()
            .map_err(|e| ConfigError::Invalid("JWT_EXPIRES_HOURS", e.to_string()))?;

        let jwt_refresh_expires_days = env::var("JWT_REFRESH_EXPIRES_DAYS")
            .unwrap_or_else(|_| "30".to_string())
            .parse::<i64>()
            .map_err(|e| ConfigError::Invalid("JWT_REFRESH_EXPIRES_DAYS", e.to_string()))?;

        let google_client_id = env::var("GOOGLE_CLIENT_ID").ok().filter(|s| !s.is_empty());

        let smtp_host = env::var("SMTP_HOST").ok().filter(|s| !s.is_empty());
        let smtp_port = env::var("SMTP_PORT")
            .ok()
            .filter(|s| !s.is_empty())
            .map(|s| {
                s.parse::<u16>()
                    .map_err(|e| ConfigError::Invalid("SMTP_PORT", e.to_string()))
            })
            .transpose()?;
        let smtp_user = env::var("SMTP_USER").ok().filter(|s| !s.is_empty());
        let smtp_pass = env::var("SMTP_PASS").ok().filter(|s| !s.is_empty());
        let smtp_from = env::var("SMTP_FROM").ok().filter(|s| !s.is_empty());

        let cors_allowed_origins = env::var("CORS_ALLOWED_ORIGINS")
            .unwrap_or_else(|_| {
                "tauri://localhost,capacitor://localhost,http://localhost:3000".to_string()
            })
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>();

        Ok(Self {
            database_url,
            redis_url,
            port,
            rust_log,
            jwt_secret,
            jwt_expires_hours,
            jwt_refresh_expires_days,
            google_client_id,
            smtp_host,
            smtp_port,
            smtp_user,
            smtp_pass,
            smtp_from,
            cors_allowed_origins,
        })
    }

    /// JWT Access Token 有效期（秒）
    pub fn jwt_access_ttl_seconds(&self) -> i64 {
        self.jwt_expires_hours * 3600
    }

    /// JWT Refresh Token 有效期（秒）
    pub fn jwt_refresh_ttl_seconds(&self) -> i64 {
        self.jwt_refresh_expires_days * 86400
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 串行化锁：所有依赖 std::env 的测试必须先获取此锁，
    /// 避免并行测试时 set_var/remove_var 互相污染（cargo test 默认多线程）。
    static ENV_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn clear_env() {
        for key in [
            "DATABASE_URL",
            "REDIS_URL",
            "PORT",
            "RUST_LOG",
            "JWT_SECRET",
            "JWT_EXPIRES_HOURS",
            "JWT_REFRESH_EXPIRES_DAYS",
            "GOOGLE_CLIENT_ID",
            "SMTP_HOST",
            "SMTP_PORT",
            "SMTP_USER",
            "SMTP_PASS",
            "SMTP_FROM",
            "CORS_ALLOWED_ORIGINS",
        ] {
            env::remove_var(key);
        }
    }

    fn set_required_env() {
        env::set_var("DATABASE_URL", "postgres://u:p@localhost:5432/db");
        env::set_var("REDIS_URL", "redis://localhost:6379");
        env::set_var("JWT_SECRET", "test_secret_with_at_least_32_bytes_long_enough_for_safe_use");
    }

    #[test]
    fn missing_database_url_fails() {
        let _lock = ENV_TEST_LOCK.lock().unwrap();
        clear_env();
        let err = AppConfig::from_env().unwrap_err();
        assert!(matches!(err, ConfigError::Missing("DATABASE_URL")));
    }

    #[test]
    fn missing_jwt_secret_fails() {
        let _lock = ENV_TEST_LOCK.lock().unwrap();
        clear_env();
        env::set_var("DATABASE_URL", "postgres://u:p@localhost:5432/db");
        env::set_var("REDIS_URL", "redis://localhost:6379");
        let err = AppConfig::from_env().unwrap_err();
        assert!(matches!(err, ConfigError::Missing("JWT_SECRET")));
    }

    #[test]
    fn defaults_applied_when_optional_missing() {
        let _lock = ENV_TEST_LOCK.lock().unwrap();
        clear_env();
        set_required_env();
        let cfg = AppConfig::from_env().unwrap();
        assert_eq!(cfg.port, 8080);
        assert_eq!(cfg.jwt_expires_hours, 24);
        assert_eq!(cfg.jwt_refresh_expires_days, 30);
        assert_eq!(cfg.google_client_id, None);
        assert_eq!(cfg.smtp_host, None);
        assert_eq!(cfg.cors_allowed_origins.len(), 3);
        assert!(cfg.cors_allowed_origins.contains(&"tauri://localhost".to_string()));
    }

    #[test]
    fn cors_origins_parsed_correctly() {
        let _lock = ENV_TEST_LOCK.lock().unwrap();
        clear_env();
        set_required_env();
        env::set_var("CORS_ALLOWED_ORIGINS", "https://a.com, https://b.com ,https://c.com");
        let cfg = AppConfig::from_env().unwrap();
        assert_eq!(cfg.cors_allowed_origins, vec![
            "https://a.com".to_string(),
            "https://b.com".to_string(),
            "https://c.com".to_string(),
        ]);
    }

    #[test]
    fn invalid_port_fails() {
        let _lock = ENV_TEST_LOCK.lock().unwrap();
        clear_env();
        set_required_env();
        env::set_var("PORT", "not_a_number");
        let err = AppConfig::from_env().unwrap_err();
        assert!(matches!(err, ConfigError::Invalid("PORT", _)));
    }

    #[test]
    fn jwt_ttl_calculations() {
        let _lock = ENV_TEST_LOCK.lock().unwrap();
        clear_env();
        set_required_env();
        env::set_var("JWT_EXPIRES_HOURS", "12");
        env::set_var("JWT_REFRESH_EXPIRES_DAYS", "7");
        let cfg = AppConfig::from_env().unwrap();
        assert_eq!(cfg.jwt_access_ttl_seconds(), 12 * 3600);
        assert_eq!(cfg.jwt_refresh_ttl_seconds(), 7 * 86400);
    }
}