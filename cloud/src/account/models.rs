//! 数据库行模型
//!
//! 这些结构体映射到 PG 表的行，通过 sqlx::FromRow 自动解码。
//! 仅在 account 模块内部使用，不暴露给 handler 外部。

use chrono::{DateTime, Utc};
use sqlx::FromRow;
use uuid::Uuid;

use shared::account::User;

/// users 表行模型
///
/// 注意：`email` 在 DB 中为 NOT NULL，但 shared::User.email 为 Option<String>。
/// 转换时包装为 Some(email)，未来 OAuth 用户无邮箱时可保留 None。
#[allow(dead_code)] // email_verified / display_name / updated_at 未来阶段才使用
#[derive(Debug, Clone, FromRow)]
pub struct UserRow {
    pub id: Uuid,
    pub email: String,
    pub password_hash: Option<String>,
    pub email_verified: bool,
    pub display_name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub is_active: bool,
}

impl From<UserRow> for User {
    fn from(row: UserRow) -> Self {
        User {
            id: row.id,
            email: Some(row.email),
            created_at: row.created_at,
            is_active: row.is_active,
        }
    }
}
