//! API 通用响应契约
//!
//! 云端所有 endpoint 遵循统一的响应格式与错误约定。

use serde::{Deserialize, Serialize};

/// 统一错误响应
///
/// 前端通过 `code` 做分支处理，`message` 用于用户可见的提示。
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "../bindings/")]
pub struct ApiError {
    /// 机器可读错误码，如 "INVALID_CREDENTIALS" / "RATE_LIMITED" / "GOOGLE_TOKEN_INVALID"
    pub code: String,
    /// 人类可读错误描述（已本地化）
    pub message: String,
}

/// 健康检查响应
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "../bindings/")]
pub struct HealthResponse {
    pub status: String,
    pub service: String,
    pub version: String,
    pub timestamp: u64,
}
