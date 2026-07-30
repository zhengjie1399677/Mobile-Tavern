use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{delete, get},
    Json, Router,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::{is_admin, AppState};

const MAX_COMMENT_CHARS: usize = 100;
const COMMENT_WINDOW_SECONDS: i64 = 3600;
const MAX_COMMENTS_PER_WINDOW: i64 = 6;
const MIN_COMMENT_INTERVAL_SECONDS: i64 = 20;
const DUPLICATE_WINDOW_SECONDS: i64 = 600;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardComment {
    id: String,
    card_id: String,
    author_name: String,
    content: String,
    created_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateCommentRequest {
    author_name: String,
    author_uuid: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct CommentQuery {
    limit: Option<u32>,
    offset: Option<u32>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/cards/:id/comments",
            get(list_comments).post(create_comment),
        )
        .route("/api/comments/:id", delete(delete_comment))
}

async fn list_comments(
    State(state): State<AppState>,
    Path(card_id): Path<String>,
    Query(query): Query<CommentQuery>,
) -> Result<Json<Vec<CardComment>>, ApiError> {
    let path = state.config.database_path();
    let limit = query.limit.unwrap_or(30).clamp(1, 50);
    let offset = query.offset.unwrap_or(0);
    run_database(move || {
        let connection = Connection::open(path)?;
        let mut statement = connection.prepare(
            "SELECT id, card_id, author_name, content, created_at
             FROM card_comments WHERE card_id = ?1
             ORDER BY created_at DESC LIMIT ?2 OFFSET ?3",
        )?;
        let comments = statement
            .query_map(params![card_id, limit, offset], |row| {
                Ok(CardComment {
                    id: row.get(0)?,
                    card_id: row.get(1)?,
                    author_name: row.get(2)?,
                    content: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(comments)
    })
    .await
    .map(Json)
}

async fn create_comment(
    State(state): State<AppState>,
    Path(card_id): Path<String>,
    Json(request): Json<CreateCommentRequest>,
) -> Result<(StatusCode, Json<CardComment>), ApiError> {
    let author_name = request.author_name.trim().to_owned();
    let author_uuid = request.author_uuid.trim().to_owned();
    let content = request.content.trim().to_owned();
    validate_identity(&author_name, &author_uuid)?;
    validate_comment_text(&content)?;

    let path = state.config.database_path();
    let id = Uuid::new_v4().to_string();
    let created_at = unix_timestamp();
    let result = CardComment {
        id: id.clone(),
        card_id: card_id.clone(),
        author_name: author_name.clone(),
        content: content.clone(),
        created_at,
    };
    run_database(move || {
        let mut connection = Connection::open(path)?;
        let transaction = connection.transaction()?;
        let card_exists: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM cards WHERE id = ?1)",
            [&card_id],
            |row| row.get(0),
        )?;
        if !card_exists {
            return Err(policy_error("CARD_NOT_FOUND"));
        }
        let (recent_count, last_created): (i64, Option<i64>) = transaction.query_row(
            "SELECT COUNT(*), MAX(created_at) FROM card_comments
             WHERE author_uuid = ?1 AND created_at > ?2",
            params![author_uuid, created_at - COMMENT_WINDOW_SECONDS],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        if recent_count >= MAX_COMMENTS_PER_WINDOW {
            return Err(policy_error("COMMENT_RATE_LIMIT"));
        }
        if last_created.is_some_and(|last| created_at - last < MIN_COMMENT_INTERVAL_SECONDS) {
            return Err(policy_error("COMMENT_TOO_FAST"));
        }
        let duplicate: bool = transaction.query_row(
            "SELECT EXISTS(
                SELECT 1 FROM card_comments
                WHERE card_id = ?1 AND author_uuid = ?2 AND content = ?3 AND created_at > ?4
             )",
            params![
                card_id,
                author_uuid,
                content,
                created_at - DUPLICATE_WINDOW_SECONDS
            ],
            |row| row.get(0),
        )?;
        if duplicate {
            return Err(policy_error("COMMENT_DUPLICATE"));
        }
        transaction.execute(
            "INSERT INTO card_comments
             (id, card_id, author_name, author_uuid, content, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, card_id, author_name, author_uuid, content, created_at],
        )?;
        transaction.commit()
    })
    .await?;
    Ok((StatusCode::CREATED, Json(result)))
}

async fn delete_comment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(comment_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    if !is_admin(&state, &headers) {
        return Err(api_error(StatusCode::UNAUTHORIZED, "管理员凭证无效"));
    }
    let path = state.config.database_path();
    let affected = run_database(move || {
        Connection::open(path)?.execute("DELETE FROM card_comments WHERE id = ?1", [&comment_id])
    })
    .await?;
    if affected == 0 {
        return Err(api_error(StatusCode::NOT_FOUND, "评论不存在"));
    }
    Ok(StatusCode::NO_CONTENT)
}

type ApiError = (StatusCode, Json<serde_json::Value>);

fn api_error(status: StatusCode, message: impl Into<String>) -> ApiError {
    (status, Json(json!({ "error": message.into() })))
}

fn validate_identity(name: &str, uuid: &str) -> Result<(), ApiError> {
    if name.is_empty() || name.chars().count() > 64 || Uuid::parse_str(uuid).is_err() {
        return Err(api_error(StatusCode::BAD_REQUEST, "评论者身份无效"));
    }
    Ok(())
}

fn validate_comment_text(content: &str) -> Result<(), ApiError> {
    if content.is_empty() || content.chars().count() > MAX_COMMENT_CHARS {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "评论必须为 1 至 100 个字符",
        ));
    }
    Ok(())
}

fn policy_error(code: &str) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(code.to_owned())
}

async fn run_database<T, F>(operation: F) -> Result<T, ApiError>
where
    T: Send + 'static,
    F: FnOnce() -> rusqlite::Result<T> + Send + 'static,
{
    match tokio::task::spawn_blocking(operation).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(rusqlite::Error::InvalidParameterName(code))) => {
            let (status, message) = match code.as_str() {
                "CARD_NOT_FOUND" => (StatusCode::NOT_FOUND, "角色卡不存在"),
                "COMMENT_RATE_LIMIT" => (StatusCode::TOO_MANY_REQUESTS, "一小时最多发表 6 条评论"),
                "COMMENT_TOO_FAST" => (StatusCode::TOO_MANY_REQUESTS, "两条评论至少间隔 20 秒"),
                "COMMENT_DUPLICATE" => (StatusCode::CONFLICT, "请勿重复发表相同评论"),
                _ => (StatusCode::BAD_REQUEST, "评论请求无效"),
            };
            Err(api_error(status, message))
        }
        Ok(Err(error)) => {
            tracing::error!(%error, "评论数据库操作失败");
            Err(api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "社区数据库操作失败",
            ))
        }
        Err(error) => {
            tracing::error!(%error, "评论数据库任务失败");
            Err(api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "社区数据库任务失败",
            ))
        }
    }
}

fn unix_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_comment_by_unicode_character_count() {
        assert!(validate_comment_text("很好").is_ok());
        assert!(validate_comment_text("").is_err());
        assert!(validate_comment_text(&"角".repeat(100)).is_ok());
        assert!(validate_comment_text(&"角".repeat(101)).is_err());
    }
}
