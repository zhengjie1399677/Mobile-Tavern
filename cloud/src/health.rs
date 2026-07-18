//! 健康检查端点
//!
//! 设计要点：
//!   1. /health 浅层探针：仅返回服务存活，用于 Docker / LB 探活（不依赖 DB/Redis）
//!   2. /health/deep 深度探针：检查 DB/Redis 连通性，用于运维监控告警
//!   3. 深度探针失败时返回 503，但浅层探针始终 200（避免 LB 误剔除）

use std::time::SystemTime;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Serialize;

use crate::state::AppState;

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub service: &'static str,
    pub version: &'static str,
    pub timestamp: u64,
}

#[derive(Serialize)]
pub struct DeepHealthResponse {
    pub status: &'static str,
    pub service: &'static str,
    pub version: &'static str,
    pub timestamp: u64,
    pub database: &'static str,
    pub redis: &'static str,
}

/// `GET /health` —— 浅层存活探针
///
/// 不依赖任何外部服务，仅返回进程存活状态。
/// Docker / LB 应使用此端点做探活，避免 DB 抖动导致容器被误判为不健康。
pub async fn health_check() -> Json<HealthResponse> {
    let timestamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    Json(HealthResponse {
        status: "ok",
        service: "mobile-tavern-cloud",
        version: env!("CARGO_PKG_VERSION"),
        timestamp,
    })
}

/// `GET /health/deep` —— 深度健康探针
///
/// 检查 DB（SELECT 1）与 Redis（PING）连通性。
/// 任一失败返回 503 + 具体失败项，全部成功返回 200。
pub async fn deep_health_check(State(state): State<AppState>) -> impl IntoResponse {
    let timestamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let db_status = match crate::db::check_health(&state.pool).await {
        Ok(()) => "ok",
        Err(e) => {
            tracing::error!(error = ?e, "深度健康检查: DB 失败");
            "error"
        }
    };

    let redis_status = {
        let mut conn = state.redis.clone();
        match crate::redis::check_health(&mut conn).await {
            Ok(()) => "ok",
            Err(e) => {
                tracing::error!(error = ?e, "深度健康检查: Redis 失败");
                "error"
            }
        }
    };

    let overall = if db_status == "ok" && redis_status == "ok" {
        "ok"
    } else {
        "degraded"
    };

    let body = DeepHealthResponse {
        status: overall,
        service: "mobile-tavern-cloud",
        version: env!("CARGO_PKG_VERSION"),
        timestamp,
        database: db_status,
        redis: redis_status,
    };

    let status_code = if overall == "ok" {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    (status_code, Json(body))
}
