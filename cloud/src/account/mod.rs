//! 账号模块：邮箱注册 + 登录 + JWT 签发 + Refresh Token 轮换
//!
//! 路由（详见 docs/agents/cloud_strategy.md 第 5 节）：
//!   - POST /account/register  邮箱注册
//!   - POST /account/login     邮箱登录
//!   - POST /account/refresh   刷新 access token（refresh token 轮换）
//!   - POST /account/logout    登出（撤销 refresh token + Redis 黑名单）
//!
//! 安全设计：
//!   1. 密码使用 argon2id 哈希，严禁明文存储
//!   2. access token 短期（默认 24h），refresh token 长期（默认 30d）
//!   3. refresh token 支持轮换（每次刷新生成新 jti，旧 jti 撤销 + 黑名单）
//!   4. refresh token 黑名单存 Redis，TTL = token 剩余有效期，避免永久堆积

pub mod handlers;
pub mod jwt;
pub mod models;
pub mod password;

use axum::{routing::post, Router};

use crate::state::AppState;

/// 装配 /account/* 路由
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/account/register", post(handlers::register))
        .route("/account/login", post(handlers::login))
        .route("/account/refresh", post(handlers::refresh))
        .route("/account/logout", post(handlers::logout))
}
