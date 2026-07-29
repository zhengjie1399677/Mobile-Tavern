//! JWT 签发与校验 + Refresh Token Redis 黑名单
//!
//! 设计要点：
//!   1. access token 与 refresh token 使用相同的 HS256 密钥但 claims 结构不同
//!   2. token_type 字段区分 "access" / "refresh"，防止混用
//!   3. refresh token 携带 jti (JWT ID)，在 DB 持久化 + Redis 黑名单双重追踪
//!   4. 黑名单 key 格式：`revoked:refresh:{jti}`，TTL = token 剩余有效期

use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use shared::account::User;

use crate::config::AppConfig;
use crate::error::{AppError, AppResult};

/// Access Token 的 JWT claims
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessClaims {
    /// Subject：用户 ID
    pub sub: Uuid,
    /// 用户邮箱（仅展示用，非权威）
    pub email: Option<String>,
    /// 签发时间（Unix 时间戳）
    pub iat: i64,
    /// 过期时间（Unix 时间戳）
    pub exp: i64,
    /// Token 类型：固定 "access"
    pub token_type: String,
}

/// Refresh Token 的 JWT claims
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefreshClaims {
    pub sub: Uuid,
    pub email: Option<String>,
    pub iat: i64,
    pub exp: i64,
    /// JWT ID：唯一标识此 refresh token，用于撤销追踪
    pub jti: Uuid,
    /// Token 类型：固定 "refresh"
    pub token_type: String,
}

/// 签发 access token
///
/// 返回 `(token_string, expires_in_seconds)`。
pub fn create_access_token(user: &User, cfg: &AppConfig) -> AppResult<(String, u64)> {
    let now = Utc::now();
    let ttl = cfg.jwt_access_ttl_seconds();
    let claims = AccessClaims {
        sub: user.id,
        email: user.email.clone(),
        iat: now.timestamp(),
        exp: (now + Duration::seconds(ttl)).timestamp(),
        token_type: "access".to_string(),
    };
    let token = encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(cfg.jwt_secret.as_bytes()),
    )?;
    Ok((token, ttl as u64))
}

/// 签发 refresh token
///
/// 返回 `(token_string, jti)`。jti 需持久化到 DB 的 refresh_tokens 表。
pub fn create_refresh_token(user: &User, cfg: &AppConfig) -> AppResult<(String, Uuid)> {
    let now = Utc::now();
    let ttl = cfg.jwt_refresh_ttl_seconds();
    let jti = Uuid::new_v4();
    let claims = RefreshClaims {
        sub: user.id,
        email: user.email.clone(),
        iat: now.timestamp(),
        exp: (now + Duration::seconds(ttl)).timestamp(),
        jti,
        token_type: "refresh".to_string(),
    };
    let token = encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(cfg.jwt_secret.as_bytes()),
    )?;
    Ok((token, jti))
}

/// 校验 access token 签名 + 过期
pub fn verify_access_token(token: &str, cfg: &AppConfig) -> AppResult<AccessClaims> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    let data = decode::<AccessClaims>(
        token,
        &DecodingKey::from_secret(cfg.jwt_secret.as_bytes()),
        &validation,
    )?;
    if data.claims.token_type != "access" {
        return Err(AppError::BadRequest(
            "token 类型不匹配：期望 access".to_string(),
        ));
    }
    Ok(data.claims)
}

/// 校验 refresh token 签名 + 过期
pub fn verify_refresh_token(token: &str, cfg: &AppConfig) -> AppResult<RefreshClaims> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    let data = decode::<RefreshClaims>(
        token,
        &DecodingKey::from_secret(cfg.jwt_secret.as_bytes()),
        &validation,
    )?;
    if data.claims.token_type != "refresh" {
        return Err(AppError::BadRequest(
            "token 类型不匹配：期望 refresh".to_string(),
        ));
    }
    Ok(data.claims)
}

/// 将 refresh token 加入 Redis 黑名单
///
/// key: `revoked:refresh:{jti}`，TTL = `ttl_seconds`。
/// TTL 设为 token 剩余有效期，过期后 key 自动清除，避免黑名单永久膨胀。
pub async fn blacklist_refresh_token(
    conn: &mut ConnectionManager,
    jti: Uuid,
    ttl_seconds: i64,
) -> AppResult<()> {
    let key = format!("revoked:refresh:{jti}");
    let _: () = conn.set_ex(key, "1", ttl_seconds.max(1) as u64).await?;
    Ok(())
}

/// 查询 refresh token 是否在黑名单中
pub async fn is_refresh_token_blacklisted(
    conn: &mut ConnectionManager,
    jti: Uuid,
) -> AppResult<bool> {
    let key = format!("revoked:refresh:{jti}");
    let exists: bool = conn.exists(key).await?;
    Ok(exists)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::AppConfig;

    fn test_config() -> AppConfig {
        AppConfig {
            database_url: String::new(),
            redis_url: String::new(),
            port: 8080,
            rust_log: String::new(),
            jwt_secret: "test_secret_with_at_least_32_bytes_long_enough_for_testing".to_string(),
            jwt_expires_hours: 24,
            jwt_refresh_expires_days: 30,
            google_client_id: None,
            smtp_host: None,
            smtp_port: None,
            smtp_user: None,
            smtp_pass: None,
            smtp_from: None,
            cors_allowed_origins: vec![],
        }
    }

    fn test_user() -> User {
        User {
            id: Uuid::new_v4(),
            email: Some("test@example.com".to_string()),
            created_at: Utc::now(),
            is_active: true,
        }
    }

    #[test]
    fn access_token_roundtrip() {
        let cfg = test_config();
        let user = test_user();
        let (token, expires_in) = create_access_token(&user, &cfg).unwrap();
        assert_eq!(expires_in, cfg.jwt_access_ttl_seconds() as u64);

        let claims = verify_access_token(&token, &cfg).unwrap();
        assert_eq!(claims.sub, user.id);
        assert_eq!(claims.email, user.email);
        assert_eq!(claims.token_type, "access");
    }

    #[test]
    fn refresh_token_roundtrip() {
        let cfg = test_config();
        let user = test_user();
        let (token, jti) = create_refresh_token(&user, &cfg).unwrap();

        let claims = verify_refresh_token(&token, &cfg).unwrap();
        assert_eq!(claims.sub, user.id);
        assert_eq!(claims.jti, jti);
        assert_eq!(claims.token_type, "refresh");
    }

    #[test]
    fn expired_access_token_rejected() {
        let cfg = test_config();
        let now = Utc::now();
        let claims = AccessClaims {
            sub: Uuid::new_v4(),
            email: None,
            iat: now.timestamp() - 7200,
            exp: now.timestamp() - 3600, // 1 小时前过期
            token_type: "access".to_string(),
        };
        let token = encode(
            &Header::new(Algorithm::HS256),
            &claims,
            &EncodingKey::from_secret(cfg.jwt_secret.as_bytes()),
        )
        .unwrap();
        assert!(verify_access_token(&token, &cfg).is_err());
    }

    #[test]
    fn tampered_token_rejected() {
        let cfg = test_config();
        let user = test_user();
        let (mut token, _) = create_access_token(&user, &cfg).unwrap();
        // 篡改最后一个字符
        let last = token.pop().unwrap();
        let tampered = if last == 'A' { 'B' } else { 'A' };
        token.push(tampered);
        assert!(verify_access_token(&token, &cfg).is_err());
    }

    #[test]
    fn wrong_token_type_rejected() {
        let cfg = test_config();
        let user = test_user();
        // 用 refresh token 验证 access
        let (token, _) = create_refresh_token(&user, &cfg).unwrap();
        assert!(verify_access_token(&token, &cfg).is_err());
    }

    #[test]
    fn wrong_secret_rejected() {
        let cfg = test_config();
        let user = test_user();
        let (token, _) = create_access_token(&user, &cfg).unwrap();

        let mut cfg2 = cfg;
        cfg2.jwt_secret = "different_secret_also_at_least_32_bytes_long".to_string();
        assert!(verify_access_token(&token, &cfg2).is_err());
    }

    #[test]
    fn blacklist_functions_compile() {
        // 编译期检查：Redis 函数签名正确（实际测试需真实 Redis 实例）
        let _ = (blacklist_refresh_token, is_refresh_token_blacklisted);
    }
}