//! 账号体系共享类型
//!
//! 这些类型同时被云端后端（Rust）和移动端前端（TypeScript）使用。
//! ts-rs 会在 `cargo build -p shared` 时自动导出到 `shared/bindings/account.ts`。

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// 登录方式提供者
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "../bindings/")]
#[serde(rename_all = "lowercase")]
pub enum IdentityProvider {
    /// 邮箱密码注册（自建兜底入口）
    Email,
    /// Google OAuth 一键登录（主入口，转化率优化）
    Google,
}

/// 统一用户主表
///
/// 无论从哪个入口登录，都映射到同一个 User。
/// `email` 对 Google 用户取 Google 邮箱，对邮箱注册用户为注册邮箱；
/// `password_hash` 仅邮箱用户有，Google 用户为 None（不存密码）。
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "../bindings/")]
pub struct User {
    pub id: Uuid,
    pub email: Option<String>,
    pub created_at: DateTime<Utc>,
    pub is_active: bool,
}

/// 多 identity 绑定（同一 user 可关联多个登录方式）
///
/// 未来扩展微信/Apple/手机号等登录方式时，只需新增 IdentityProvider 枚举值，
/// schema 与此类型均无需改动。
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "../bindings/")]
pub struct Identity {
    pub id: Uuid,
    pub user_id: Uuid,
    pub provider: IdentityProvider,
    /// Google 的 sub / 邮箱地址
    pub provider_uid: String,
    pub created_at: DateTime<Utc>,
}

/// 邮箱注册请求
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "../bindings/")]
pub struct EmailRegisterRequest {
    pub email: String,
    pub password: String,
}

/// 邮箱登录请求
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "../bindings/")]
pub struct EmailLoginRequest {
    pub email: String,
    pub password: String,
}

/// Google OAuth 登录请求（客户端传 Google Sign-In SDK 获取的 ID Token）
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "../bindings/")]
pub struct GoogleLoginRequest {
    pub id_token: String,
}

/// 登录响应（返回自签 JWT + 用户信息）
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "../bindings/")]
pub struct LoginResponse {
    pub access_token: String,
    pub refresh_token: String,
    /// access_token 过期秒数
    pub expires_in: u64,
    pub user: User,
}

/// Token 刷新请求
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "../bindings/")]
pub struct RefreshTokenRequest {
    pub refresh_token: String,
}