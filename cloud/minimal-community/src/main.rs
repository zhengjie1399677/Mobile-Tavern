use std::{net::SocketAddr, sync::Arc};

use axum::{
    extract::State,
    http::{Method, StatusCode},
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use serde_json::json;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    trace::TraceLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

mod cards;
mod config;
mod database;
mod upload_guard;

use config::AppConfig;
use upload_guard::UploadGuard;

#[derive(Clone)]
pub(crate) struct AppState {
    config: Arc<AppConfig>,
    upload_guard: Arc<UploadGuard>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(tracing_subscriber::fmt::layer().with_target(false))
        .init();

    let config = AppConfig::from_env()?;
    config.ensure_directories()?;
    database::initialize(&config.database_path())?;

    let upload_guard = UploadGuard::new(
        &config.cards_dir(),
        config.max_storage_bytes,
        config.max_uploads_per_window,
        config.upload_window_seconds,
    )?;
    let state = AppState {
        config: Arc::new(config),
        upload_guard: Arc::new(upload_guard),
    };
    let app = build_router(state.clone());
    let address = SocketAddr::from(([127, 0, 0, 1], state.config.port));
    let listener = tokio::net::TcpListener::bind(address).await?;

    tracing::info!(%address, "Mobile Tavern 最小社区服务已启动");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

fn build_router(state: AppState) -> Router {
    let allowed_origins = state
        .config
        .cors_allowed_origins
        .iter()
        .filter_map(|origin| origin.parse().ok())
        .collect::<Vec<_>>();

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(allowed_origins))
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::HeaderName::from_static("x-admin-token"),
        ]);

    Router::new()
        .route("/", get(root))
        .route("/health", get(health))
        .route("/health/deep", get(deep_health))
        .merge(cards::router())
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn root() -> Json<serde_json::Value> {
    Json(json!({
        "service": "mobile-tavern-community",
        "status": "ok",
        "stage": "minimal-validation"
    }))
}

async fn health() -> StatusCode {
    StatusCode::NO_CONTENT
}

async fn deep_health(State(state): State<AppState>) -> impl IntoResponse {
    let database_path = state.config.database_path();
    match tokio::task::spawn_blocking(move || database::verify(&database_path)).await {
        Ok(Ok(())) => (
            StatusCode::OK,
            Json(json!({ "status": "ok", "database": "sqlite" })),
        ),
        Ok(Err(error)) => {
            tracing::error!(%error, "SQLite 深度健康检查失败");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "status": "error", "database": "unavailable" })),
            )
        }
        Err(error) => {
            tracing::error!(%error, "SQLite 深度健康检查任务失败");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "status": "error", "database": "check_failed" })),
            )
        }
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("无法安装 Ctrl+C 信号处理器");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("无法安装 SIGTERM 信号处理器")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }
}
