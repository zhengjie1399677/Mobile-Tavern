use std::{
    env,
    path::{Path, PathBuf},
};

use thiserror::Error;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("环境变量 {0} 的值无效：{1}")]
    Invalid(&'static str, String),
}

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub port: u16,
    pub data_dir: PathBuf,
    pub cors_allowed_origins: Vec<String>,
    pub max_storage_bytes: u64,
    pub max_uploads_per_window: usize,
    pub upload_window_seconds: u64,
    pub admin_token: Option<String>,
}

impl AppConfig {
    pub fn from_env() -> Result<Self, ConfigError> {
        let port = env::var("PORT")
            .unwrap_or_else(|_| "8080".to_owned())
            .parse::<u16>()
            .map_err(|error| ConfigError::Invalid("PORT", error.to_string()))?;

        let data_dir = PathBuf::from(env::var("DATA_DIR").unwrap_or_else(|_| "./data".to_owned()));

        let cors_allowed_origins = env::var("CORS_ALLOWED_ORIGINS")
            .unwrap_or_else(|_| "tauri://localhost".to_owned())
            .split(',')
            .map(str::trim)
            .filter(|origin| !origin.is_empty())
            .map(str::to_owned)
            .collect();

        let max_storage_bytes = parse_env("MAX_STORAGE_BYTES", 8 * 1024 * 1024 * 1024)?;
        let max_uploads_per_window = parse_env("MAX_UPLOADS_PER_WINDOW", 3)?;
        let upload_window_seconds = parse_env("UPLOAD_WINDOW_SECONDS", 600)?;
        let admin_token = env::var("ADMIN_TOKEN")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        if admin_token.as_ref().is_some_and(|token| token.len() < 32) {
            return Err(ConfigError::Invalid(
                "ADMIN_TOKEN",
                "必须至少包含 32 个字符".to_owned(),
            ));
        }

        Ok(Self {
            port,
            data_dir,
            cors_allowed_origins,
            max_storage_bytes,
            max_uploads_per_window,
            upload_window_seconds,
            admin_token,
        })
    }

    pub fn database_path(&self) -> PathBuf {
        self.data_dir.join("database").join("community.sqlite3")
    }

    pub fn cards_dir(&self) -> PathBuf {
        self.data_dir.join("uploads").join("cards")
    }

    pub fn thumbnails_dir(&self) -> PathBuf {
        self.data_dir.join("uploads").join("thumbnails")
    }

    pub fn ensure_directories(&self) -> std::io::Result<()> {
        for path in [
            self.database_path().parent().map(Path::to_path_buf),
            Some(self.cards_dir()),
            Some(self.thumbnails_dir()),
        ]
        .into_iter()
        .flatten()
        {
            std::fs::create_dir_all(path)?;
        }
        Ok(())
    }
}

fn parse_env<T>(name: &'static str, default: T) -> Result<T, ConfigError>
where
    T: std::str::FromStr + ToString,
    T::Err: std::fmt::Display,
{
    env::var(name)
        .unwrap_or_else(|_| default.to_string())
        .parse::<T>()
        .map_err(|error| ConfigError::Invalid(name, error.to_string()))
}
