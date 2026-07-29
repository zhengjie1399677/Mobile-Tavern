//! 统一错误类型与 HTTP 响应转换
//!
//! 设计要点：
//!   1. AppError 聚合所有错误来源（DB / Redis / JWT / 业务等），handler 只返回 AppError
//!   2. IntoResponse 实现确保错误响应格式与 shared::api::ApiError 契约一致
//!   3. 5xx 错误统一记录 tracing::error，不向客户端泄露内部细节
//!   4. 4xx 业务错误返回具体 message，便于前端展示与调试

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use thiserror::Error;

use shared::api::ApiError;

#[derive(Debug, Error)]
pub enum AppError {
    // ─── 4xx 业务错误 ────────────────────────────────────────
    #[error("资源不存在")]
    NotFound,

    #[error("未认证")]
    Unauthorized,

    #[error("邮箱或密码错误")]
    InvalidCredentials,

    #[error("无权限")]
    Forbidden,

    #[error("请求参数错误: {0}")]
    BadRequest(String),

    #[error("资源冲突: {0}")]
    Conflict(String),

    #[error("请求过于频繁，请稍后再试")]
    TooManyRequests,

    #[error("Google ID Token 无效")]
    GoogleTokenInvalid,

    #[error("Google ID Token 验证失败: {0}")]
    GoogleTokenVerifyFailed(String),

    // ─── 5xx 基础设施错误（统一对外暴露为"内部错误"） ────────
    #[error("数据库错误: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Redis 错误: {0}")]
    Redis(#[from] redis::RedisError),

    #[error("JWT 错误: {0}")]
    Jwt(#[from] jsonwebtoken::errors::Error),

    #[error("密码哈希错误: {0}")]
    PasswordHash(String),

    #[error("配置错误: {0}")]
    Config(#[from] crate::config::ConfigError),

    #[error("内部错误: {0}")]
    Internal(String),
}

impl AppError {
    /// 机器可读的错误码字符串
    ///
    /// 前端依据此 code 做分支处理（如弹邮箱验证提示 / 跳转登录 / 静默重试）。
    fn code(&self) -> &'static str {
        match self {
            AppError::NotFound => "NOT_FOUND",
            AppError::Unauthorized => "UNAUTHORIZED",
            AppError::InvalidCredentials => "INVALID_CREDENTIALS",
            AppError::Forbidden => "FORBIDDEN",
            AppError::BadRequest(_) => "BAD_REQUEST",
            AppError::Conflict(_) => "CONFLICT",
            AppError::TooManyRequests => "RATE_LIMITED",
            AppError::GoogleTokenInvalid => "GOOGLE_TOKEN_INVALID",
            AppError::GoogleTokenVerifyFailed(_) => "GOOGLE_TOKEN_VERIFY_FAILED",
            AppError::Database(_) => "DATABASE_ERROR",
            AppError::Redis(_) => "REDIS_ERROR",
            AppError::Jwt(_) => "JWT_ERROR",
            AppError::PasswordHash(_) => "PASSWORD_HASH_ERROR",
            AppError::Config(_) => "CONFIG_ERROR",
            AppError::Internal(_) => "INTERNAL_ERROR",
        }
    }

    /// 对外暴露的 message（5xx 统一脱敏为"内部错误"）
    fn safe_message(&self) -> String {
        match self {
            // 5xx 全部脱敏，避免泄露内部细节
            AppError::Database(_)
            | AppError::Redis(_)
            | AppError::Jwt(_)
            | AppError::PasswordHash(_)
            | AppError::Config(_)
            | AppError::Internal(_) => "内部错误，请稍后重试".to_string(),

            // 4xx 业务错误直接透传 message
            _ => self.to_string(),
        }
    }

    /// 对应的 HTTP 状态码
    fn status_code(&self) -> StatusCode {
        match self {
            AppError::NotFound => StatusCode::NOT_FOUND,
            AppError::Unauthorized | AppError::InvalidCredentials => StatusCode::UNAUTHORIZED,
            AppError::Forbidden => StatusCode::FORBIDDEN,
            AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
            AppError::Conflict(_) => StatusCode::CONFLICT,
            AppError::TooManyRequests => StatusCode::TOO_MANY_REQUESTS,
            AppError::GoogleTokenInvalid | AppError::GoogleTokenVerifyFailed(_) => {
                StatusCode::UNAUTHORIZED
            }
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = self.status_code();

        // 5xx 错误记录完整堆栈到日志，4xx 仅 debug 级别
        if status.is_server_error() {
            tracing::error!(error = %self, code = self.code(), "服务器内部错误");
        } else {
            tracing::debug!(error = %self, code = self.code(), "业务错误");
        }

        let body = ApiError {
            code: self.code().to_string(),
            message: self.safe_message(),
        };

        (status, axum::Json(body)).into_response()
    }
}

/// 通用 Result 类型别名，简化 handler 签名
pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use axum::http::StatusCode;

    #[tokio::test]
    async fn not_found_maps_to_404() {
        let resp = AppError::NotFound.into_response();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn invalid_credentials_maps_to_401() {
        let resp = AppError::InvalidCredentials.into_response();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn conflict_maps_to_409() {
        let resp = AppError::Conflict("邮箱已注册".to_string()).into_response();
        assert_eq!(resp.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn database_error_maps_to_500_and_sanitized() {
        // 构造一个 sqlx::Error 比较复杂，这里用 Internal 替代验证脱敏逻辑
        let resp = AppError::Internal("db connection refused at 10.0.0.1:5432".to_string())
            .into_response();
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);

        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let body: ApiError = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body.code, "INTERNAL_ERROR");
        // 内部细节不应泄露
        assert_eq!(body.message, "内部错误，请稍后重试");
        assert!(!body.message.contains("10.0.0.1"));
    }

    #[tokio::test]
    async fn bad_request_message_passed_through() {
        let resp = AppError::BadRequest("邮箱格式不合法".to_string()).into_response();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let body: ApiError = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body.code, "BAD_REQUEST");
        assert_eq!(body.message, "请求参数错误: 邮箱格式不合法");
    }

    #[test]
    fn code_strings_are_stable() {
        // 错误码是对外契约，变更需同步前端
        assert_eq!(AppError::NotFound.code(), "NOT_FOUND");
        assert_eq!(AppError::InvalidCredentials.code(), "INVALID_CREDENTIALS");
        assert_eq!(AppError::TooManyRequests.code(), "RATE_LIMITED");
        assert_eq!(AppError::GoogleTokenInvalid.code(), "GOOGLE_TOKEN_INVALID");
    }
}
