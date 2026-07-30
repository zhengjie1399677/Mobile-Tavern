use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    extract::{DefaultBodyLimit, Multipart, Path as AxumPath, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{delete, get, post},
    Json, Router,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::AppState;

const MAX_CARD_BYTES: usize = 10 * 1024 * 1024;
const MAX_NAME_CHARS: usize = 64;
const MAX_TITLE_CHARS: usize = 100;
const MAX_DESCRIPTION_CHARS: usize = 1000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardSummary {
    id: String,
    title: String,
    description: String,
    mime_type: String,
    file_size: i64,
    uploader_name: String,
    created_at: i64,
    last_downloaded_at: Option<i64>,
    download_count: i64,
    download_url: String,
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    q: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    actor_name: String,
    actor_uuid: String,
}

#[derive(Debug)]
struct UploadInput {
    title: String,
    description: String,
    uploader_name: String,
    uploader_uuid: String,
    file_name: String,
    mime_type: String,
    bytes: Vec<u8>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/cards", get(list_cards).post(upload_card))
        .route("/api/cards/:id/download", post(record_download))
        .route("/api/cards/:id", delete(delete_card))
        .layer(DefaultBodyLimit::max(MAX_CARD_BYTES + 64 * 1024))
}

async fn list_cards(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> Result<Json<Vec<CardSummary>>, (StatusCode, Json<serde_json::Value>)> {
    let database_path = state.config.database_path();
    let limit = query.limit.unwrap_or(30).clamp(1, 50);
    let offset = query.offset.unwrap_or(0);
    let search = query.q.unwrap_or_default().trim().to_owned();

    run_database(move || {
        let connection = Connection::open(database_path)?;
        let pattern = format!("%{search}%");
        let mut statement = connection.prepare(
            "SELECT id, title, description, mime_type, file_size, uploader_name,
                    created_at,
                    (SELECT MAX(downloaded_at) FROM card_downloads WHERE card_id = cards.id),
                    download_count, file_name
             FROM cards
             WHERE (?1 = '' OR title LIKE ?2 ESCAPE '\\' OR description LIKE ?2 ESCAPE '\\')
             ORDER BY created_at DESC
             LIMIT ?3 OFFSET ?4",
        )?;
        let rows = statement.query_map(params![search, pattern, limit, offset], |row| {
            let file_name: String = row.get(9)?;
            Ok(CardSummary {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                mime_type: row.get(3)?,
                file_size: row.get(4)?,
                uploader_name: row.get(5)?,
                created_at: row.get(6)?,
                last_downloaded_at: row.get(7)?,
                download_count: row.get(8)?,
                download_url: format!("/cards/{file_name}"),
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    })
    .await
    .map(Json)
}

async fn upload_card(
    State(state): State<AppState>,
    headers: HeaderMap,
    multipart: Multipart,
) -> Result<(StatusCode, Json<CardSummary>), (StatusCode, Json<serde_json::Value>)> {
    let client_key = client_key(&headers);
    if let Err(retry_after) = state.upload_guard.check_rate_limit(&client_key) {
        return Err(api_error(
            StatusCode::TOO_MANY_REQUESTS,
            format!("上传过于频繁，请在 {retry_after} 秒后重试"),
        ));
    }
    let input = read_upload(multipart).await?;
    validate_upload(&input)?;
    let reserved_bytes = input.bytes.len() as u64;
    if !state.upload_guard.reserve_storage(reserved_bytes) {
        return Err(api_error(
            StatusCode::INSUFFICIENT_STORAGE,
            "社区角色卡存储空间已达到配置上限",
        ));
    }

    let id = Uuid::new_v4().to_string();
    let extension = if input.mime_type == "image/png" {
        "png"
    } else {
        "json"
    };
    let stored_file_name = format!("{id}.{extension}");
    let target_path = state.config.cards_dir().join(&stored_file_name);
    tokio::fs::write(&target_path, &input.bytes)
        .await
        .map_err(|error| {
            state.upload_guard.release_storage(reserved_bytes);
            internal_error(error)
        })?;

    let database_path = state.config.database_path();
    let created_at = unix_timestamp();
    let result_id = id.clone();
    let result_file_name = stored_file_name.clone();
    let result_title = input.title.clone();
    let result_description = input.description.clone();
    let result_mime_type = input.mime_type.clone();
    let result_uploader_name = input.uploader_name.clone();
    let file_size = input.bytes.len() as i64;
    let uploader_uuid = input.uploader_uuid.clone();

    let database_result = run_database(move || {
        let connection = Connection::open(database_path)?;
        connection.execute(
            "INSERT INTO cards (
                id, title, description, file_name, mime_type, file_size,
                uploader_name, uploader_uuid, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                result_id,
                result_title,
                result_description,
                result_file_name,
                result_mime_type,
                file_size,
                result_uploader_name,
                uploader_uuid,
                created_at,
            ],
        )?;
        Ok(())
    })
    .await;

    if let Err(error) = database_result {
        let _ = tokio::fs::remove_file(&target_path).await;
        state.upload_guard.release_storage(reserved_bytes);
        return Err(error);
    }

    Ok((
        StatusCode::CREATED,
        Json(CardSummary {
            id,
            title: input.title,
            description: input.description,
            mime_type: input.mime_type,
            file_size,
            uploader_name: input.uploader_name,
            created_at,
            last_downloaded_at: None,
            download_count: 0,
            download_url: format!("/cards/{stored_file_name}"),
        }),
    ))
}

async fn delete_card(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(card_id): AxumPath<String>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    let Some(expected_token) = state.config.admin_token.as_deref() else {
        return Err(api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "管理员删除接口未启用",
        ));
    };
    let supplied_token = headers
        .get("x-admin-token")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if supplied_token != expected_token {
        return Err(api_error(StatusCode::UNAUTHORIZED, "管理员令牌无效"));
    }

    let database_path = state.config.database_path();
    let lookup_id = card_id.clone();
    let card = run_database(move || {
        let connection = Connection::open(database_path)?;
        connection
            .query_row(
                "SELECT file_name, file_size FROM cards WHERE id = ?1",
                [&lookup_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, u64>(1)?)),
            )
            .optional()
    })
    .await?;
    let Some((file_name, file_size)) = card else {
        return Err(api_error(StatusCode::NOT_FOUND, "角色卡不存在"));
    };

    let delete_database_path = state.config.database_path();
    let delete_id = card_id;
    run_database(move || {
        let connection = Connection::open(delete_database_path)?;
        connection.execute("DELETE FROM cards WHERE id = ?1", [&delete_id])?;
        Ok(())
    })
    .await?;

    let file_path = state.config.cards_dir().join(file_name);
    match tokio::fs::remove_file(file_path).await {
        Ok(()) => state.upload_guard.release_storage(file_size),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            state.upload_guard.release_storage(file_size);
        }
        Err(error) => tracing::error!(%error, "管理员删除角色卡文件失败"),
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn record_download(
    State(state): State<AppState>,
    AxumPath(card_id): AxumPath<String>,
    Json(request): Json<DownloadRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    validate_identity(&request.actor_name, &request.actor_uuid)?;
    let database_path = state.config.database_path();

    let file_name = run_database(move || {
        let mut connection = Connection::open(database_path)?;
        let transaction = connection.transaction()?;
        let file_name = transaction
            .query_row(
                "SELECT file_name FROM cards WHERE id = ?1",
                [&card_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let Some(file_name) = file_name else {
            return Ok(None);
        };
        transaction.execute(
            "INSERT INTO card_downloads (card_id, actor_name, actor_uuid, downloaded_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                card_id,
                request.actor_name,
                request.actor_uuid,
                unix_timestamp()
            ],
        )?;
        transaction.execute(
            "UPDATE cards SET download_count = download_count + 1 WHERE id = ?1",
            [&card_id],
        )?;
        transaction.commit()?;
        Ok(Some(file_name))
    })
    .await?;

    match file_name {
        Some(file_name) => Ok(Json(
            json!({ "downloadUrl": format!("/cards/{file_name}") }),
        )),
        None => Err(api_error(StatusCode::NOT_FOUND, "角色卡不存在")),
    }
}

async fn read_upload(
    mut multipart: Multipart,
) -> Result<UploadInput, (StatusCode, Json<serde_json::Value>)> {
    let mut title = None;
    let mut description = String::new();
    let mut uploader_name = None;
    let mut uploader_uuid = None;
    let mut file = None;

    while let Some(field) = multipart.next_field().await.map_err(bad_request)? {
        let field_name = field.name().unwrap_or_default().to_owned();
        match field_name.as_str() {
            "title" => title = Some(field.text().await.map_err(bad_request)?),
            "description" => description = field.text().await.map_err(bad_request)?,
            "uploaderName" => uploader_name = Some(field.text().await.map_err(bad_request)?),
            "uploaderUuid" => uploader_uuid = Some(field.text().await.map_err(bad_request)?),
            "card" => {
                let file_name = field.file_name().unwrap_or("card").to_owned();
                let declared_type = field.content_type().unwrap_or("").to_owned();
                let bytes = field.bytes().await.map_err(bad_request)?.to_vec();
                let mime_type = detect_card_type(&bytes, &declared_type)?;
                file = Some((file_name, mime_type, bytes));
            }
            _ => {}
        }
    }

    let (file_name, mime_type, bytes) =
        file.ok_or_else(|| api_error(StatusCode::BAD_REQUEST, "缺少角色卡文件"))?;
    Ok(UploadInput {
        title: title.unwrap_or_default().trim().to_owned(),
        description: description.trim().to_owned(),
        uploader_name: uploader_name.unwrap_or_default().trim().to_owned(),
        uploader_uuid: uploader_uuid.unwrap_or_default().trim().to_owned(),
        file_name,
        mime_type,
        bytes,
    })
}

fn validate_upload(input: &UploadInput) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    validate_text(&input.title, MAX_TITLE_CHARS, "角色卡标题")?;
    if input.description.chars().count() > MAX_DESCRIPTION_CHARS {
        return Err(api_error(StatusCode::BAD_REQUEST, "角色卡简介过长"));
    }
    validate_identity(&input.uploader_name, &input.uploader_uuid)?;
    if input.bytes.is_empty() || input.bytes.len() > MAX_CARD_BYTES {
        return Err(api_error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "角色卡文件必须小于等于 10MB",
        ));
    }
    if input.file_name.chars().count() > 255 {
        return Err(api_error(StatusCode::BAD_REQUEST, "文件名过长"));
    }
    Ok(())
}

fn validate_identity(name: &str, uuid: &str) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    validate_text(name, MAX_NAME_CHARS, "用户名称")?;
    Uuid::parse_str(uuid).map_err(|_| api_error(StatusCode::BAD_REQUEST, "用户 UUID 无效"))?;
    Ok(())
}

fn client_key(headers: &HeaderMap) -> String {
    headers
        .get("cf-connecting-ip")
        .or_else(|| headers.get("x-real-ip"))
        .or_else(|| headers.get("x-forwarded-for"))
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown")
        .to_owned()
}

fn validate_text(
    value: &str,
    max_chars: usize,
    field_name: &str,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let length = value.chars().count();
    if length == 0 || length > max_chars {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            format!("{field_name}不能为空且不能超过 {max_chars} 字"),
        ));
    }
    Ok(())
}

fn detect_card_type(
    bytes: &[u8],
    declared_type: &str,
) -> Result<String, (StatusCode, Json<serde_json::Value>)> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Ok("image/png".to_owned());
    }
    if (declared_type == "application/json" || bytes.first() == Some(&b'{'))
        && serde_json::from_slice::<serde_json::Value>(bytes).is_ok()
    {
        return Ok("application/json".to_owned());
    }
    Err(api_error(
        StatusCode::UNSUPPORTED_MEDIA_TYPE,
        "仅支持有效的 PNG 或 JSON 角色卡",
    ))
}

async fn run_database<T, F>(operation: F) -> Result<T, (StatusCode, Json<serde_json::Value>)>
where
    T: Send + 'static,
    F: FnOnce() -> rusqlite::Result<T> + Send + 'static,
{
    tokio::task::spawn_blocking(operation)
        .await
        .map_err(internal_error)?
        .map_err(internal_error)
}

fn unix_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn bad_request(error: impl std::fmt::Display) -> (StatusCode, Json<serde_json::Value>) {
    api_error(StatusCode::BAD_REQUEST, error.to_string())
}

fn internal_error(error: impl std::fmt::Display) -> (StatusCode, Json<serde_json::Value>) {
    tracing::error!(%error, "社区角色卡接口发生内部错误");
    api_error(StatusCode::INTERNAL_SERVER_ERROR, "服务器内部错误")
}

fn api_error(
    status: StatusCode,
    message: impl Into<String>,
) -> (StatusCode, Json<serde_json::Value>) {
    (status, Json(json!({ "error": message.into() })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_png_signature_and_valid_json() {
        assert_eq!(
            detect_card_type(
                &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A],
                "application/octet-stream"
            )
            .unwrap(),
            "image/png"
        );
        assert_eq!(
            detect_card_type(br#"{"name":"card"}"#, "application/json").unwrap(),
            "application/json"
        );
    }

    #[test]
    fn rejects_invalid_identity() {
        assert!(validate_identity("", &Uuid::new_v4().to_string()).is_err());
        assert!(validate_identity("user", "not-a-uuid").is_err());
    }
}
