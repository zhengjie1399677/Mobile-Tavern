//! 账号 handler：register / login / refresh / logout
//!
//! 所有 handler 返回 `AppResult<Json<T>>` 或 `AppResult<StatusCode>`，
//! 错误统一经 AppError → IntoResponse 转换为标准 JSON 错误响应。

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use chrono::{DateTime, Duration, Utc};
use uuid::Uuid;

use shared::account::{
    EmailLoginRequest, EmailRegisterRequest, LoginResponse, RefreshTokenRequest, User,
};

use crate::error::{AppError, AppResult};
use crate::state::AppState;

use super::jwt;
use super::models::UserRow;
use super::password;

/// `POST /account/register` — 邮箱注册
///
/// 流程：校验邮箱+密码 → 查重 → argon2 哈希 → 事务插入 user + identity → 签发 token 对
pub async fn register(
    State(state): State<AppState>,
    Json(req): Json<EmailRegisterRequest>,
) -> AppResult<Json<LoginResponse>> {
    let email = normalize_email(&req.email)?;
    validate_password(&req.password)?;

    // 预检查邮箱是否已注册（快速路径，避免无谓的 argon2 计算）
    let existing: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM users WHERE email = $1")
        .bind(&email)
        .fetch_optional(&state.pool)
        .await?;
    if existing.is_some() {
        return Err(AppError::Conflict("邮箱已注册".to_string()));
    }

    let password_hash = password::hash_password(&req.password)?;

    // 事务：插入 user + identity（失败回滚）
    let mut tx = state.pool.begin().await?;
    let user_row: UserRow = match sqlx::query_as(
        r#"INSERT INTO users (email, password_hash, email_verified)
           VALUES ($1, $2, FALSE)
           RETURNING id, email, password_hash, email_verified, display_name,
                     created_at, updated_at, is_active"#,
    )
    .bind(&email)
    .bind(&password_hash)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(row) => row,
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
            return Err(AppError::Conflict("邮箱已注册".to_string()));
        }
        Err(e) => return Err(e.into()),
    };

    sqlx::query(
        r#"INSERT INTO identities (user_id, provider, provider_user_id)
           VALUES ($1, 'email', $2)"#,
    )
    .bind(user_row.id)
    .bind(&email)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    let user: User = user_row.into();
    tracing::info!(user_id = %user.id, email = %email, "新用户注册成功");
    issue_token_pair(&state, &user).await.map(Json)
}

/// `POST /account/login` — 邮箱登录
///
/// 防用户枚举：邮箱不存在 / 密码错误 / 账号停用 统一返回 InvalidCredentials。
pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<EmailLoginRequest>,
) -> AppResult<Json<LoginResponse>> {
    let email = normalize_email(&req.email)?;

    let user_row: Option<UserRow> = sqlx::query_as(
        r#"SELECT id, email, password_hash, email_verified, display_name,
                  created_at, updated_at, is_active
           FROM users WHERE email = $1"#,
    )
    .bind(&email)
    .fetch_optional(&state.pool)
    .await?;

    let user_row = match user_row {
        Some(row) if row.is_active => row,
        Some(_) => return Err(AppError::InvalidCredentials),
        None => return Err(AppError::InvalidCredentials),
    };

    let hash = user_row
        .password_hash
        .as_ref()
        .ok_or(AppError::InvalidCredentials)?;
    if !password::verify_password(&req.password, hash)? {
        return Err(AppError::InvalidCredentials);
    }

    let user: User = user_row.into();
    tracing::info!(user_id = %user.id, email = %email, "用户登录成功");
    issue_token_pair(&state, &user).await.map(Json)
}

/// `POST /account/refresh` — 刷新 access token（refresh token 轮换）
///
/// 流程：校验 refresh token → 查 Redis 黑名单 → 查 DB 撤销状态 →
///       撤销旧 jti + 加黑名单 → 签发新 token 对
pub async fn refresh(
    State(state): State<AppState>,
    Json(req): Json<RefreshTokenRequest>,
) -> AppResult<Json<LoginResponse>> {
    let claims = jwt::verify_refresh_token(&req.refresh_token, &state.config)?;

    let mut conn = state.redis.clone();

    // Redis 黑名单检查
    if jwt::is_refresh_token_blacklisted(&mut conn, claims.jti).await? {
        return Err(AppError::Unauthorized);
    }

    // DB 撤销状态检查
    let row: Option<(Option<DateTime<Utc>>,)> =
        sqlx::query_as("SELECT revoked_at FROM refresh_tokens WHERE jti = $1")
            .bind(claims.jti)
            .fetch_optional(&state.pool)
            .await?;
    match row {
        Some((None,)) => {}           // 有效
        Some((Some(_),)) | None => return Err(AppError::Unauthorized),
    }

    // 轮换：撤销旧 token
    let now = Utc::now();
    sqlx::query("UPDATE refresh_tokens SET revoked_at = $1 WHERE jti = $2")
        .bind(now)
        .bind(claims.jti)
        .execute(&state.pool)
        .await?;

    // 加黑名单（TTL = 剩余有效期）
    let remaining = claims.exp - now.timestamp();
    if remaining > 0 {
        jwt::blacklist_refresh_token(&mut conn, claims.jti, remaining).await?;
    }

    // 查用户（确保仍活跃）
    let user_row: UserRow = sqlx::query_as(
        r#"SELECT id, email, password_hash, email_verified, display_name,
                  created_at, updated_at, is_active
           FROM users WHERE id = $1 AND is_active = TRUE"#,
    )
    .bind(claims.sub)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::Unauthorized)?;

    let user: User = user_row.into();
    issue_token_pair(&state, &user).await.map(Json)
}

/// `POST /account/logout` — 登出（撤销 refresh token）
///
/// 即使 token 无效也返回 200，避免泄露 token 状态。
pub async fn logout(
    State(state): State<AppState>,
    Json(req): Json<RefreshTokenRequest>,
) -> AppResult<StatusCode> {
    let claims = match jwt::verify_refresh_token(&req.refresh_token, &state.config) {
        Ok(c) => c,
        Err(_) => return Ok(StatusCode::OK),
    };

    let mut conn = state.redis.clone();
    let now = Utc::now();

    // 撤销 DB 记录（仅未撤销的）
    sqlx::query("UPDATE refresh_tokens SET revoked_at = $1 WHERE jti = $2 AND revoked_at IS NULL")
        .bind(now)
        .bind(claims.jti)
        .execute(&state.pool)
        .await?;

    // 加黑名单
    let remaining = claims.exp - now.timestamp();
    if remaining > 0 {
        let _ = jwt::blacklist_refresh_token(&mut conn, claims.jti, remaining).await;
    }

    Ok(StatusCode::OK)
}

/// 内部工具：签发 access + refresh token 对，并持久化 refresh token 到 DB
async fn issue_token_pair(state: &AppState, user: &User) -> AppResult<LoginResponse> {
    let (access_token, expires_in) = jwt::create_access_token(user, &state.config)?;
    let (refresh_token, jti) = jwt::create_refresh_token(user, &state.config)?;

    let expires_at = Utc::now() + Duration::seconds(state.config.jwt_refresh_ttl_seconds());
    sqlx::query("INSERT INTO refresh_tokens (jti, user_id, expires_at) VALUES ($1, $2, $3)")
        .bind(jti)
        .bind(user.id)
        .bind(expires_at)
        .execute(&state.pool)
        .await?;

    Ok(LoginResponse {
        access_token,
        refresh_token,
        expires_in,
        user: user.clone(),
    })
}

/// 邮箱规范化：trim + lowercase
fn normalize_email(input: &str) -> AppResult<String> {
    let email = input.trim().to_lowercase();
    if !is_valid_email(&email) {
        return Err(AppError::BadRequest("邮箱格式不合法".to_string()));
    }
    Ok(email)
}

/// 简单邮箱格式校验（不引入 regex，完整 RFC 5322 校验留给业务层）
fn is_valid_email(email: &str) -> bool {
    if email.len() > 255 {
        return false;
    }
    let at = match email.find('@') {
        Some(i) => i,
        None => return false,
    };
    let local = &email[..at];
    let domain = &email[at + 1..];
    !local.is_empty()
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
}

/// 密码强度校验
fn validate_password(password: &str) -> AppResult<()> {
    if password.len() < 8 {
        return Err(AppError::BadRequest("密码长度至少 8 位".to_string()));
    }
    if password.len() > 128 {
        return Err(AppError::BadRequest("密码长度不能超过 128 位".to_string()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn email_normalization_lowercases_and_trims() {
        assert_eq!(
            normalize_email("  User@Example.COM  ").unwrap(),
            "user@example.com"
        );
    }

    #[test]
    fn invalid_emails_rejected() {
        assert!(normalize_email("notanemail").is_err());
        assert!(normalize_email("@example.com").is_err());
        assert!(normalize_email("user@").is_err());
        assert!(normalize_email("user@example").is_err());
        assert!(normalize_email("user@.com").is_err());
        assert!(normalize_email("user@example.").is_err());
    }

    #[test]
    fn valid_emails_accepted() {
        assert!(normalize_email("user@example.com").is_ok());
        assert!(normalize_email("a.b@c.d.com").is_ok());
    }

    #[test]
    fn password_length_validation() {
        assert!(validate_password("short").is_err());
        assert!(validate_password("12345678").is_ok());
        assert!(validate_password(&"x".repeat(129)).is_err());
    }

    #[test]
    fn handler_signatures_compile() {
        // 编译期检查：handler 函数符号存在且签名正确
        // 实际端到端测试需真实 PG + Redis（见集成测试）
        let _ = (register, login, refresh, logout, issue_token_pair);
    }
}