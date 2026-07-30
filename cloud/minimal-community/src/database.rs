use std::path::Path;

use rusqlite::{Connection, OpenFlags};

const INITIAL_SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS schema_meta (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO schema_meta (version) VALUES (1);

CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    file_name TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL CHECK (file_size > 0),
    uploader_name TEXT NOT NULL,
    uploader_uuid TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    download_count INTEGER NOT NULL DEFAULT 0,
    file_sha256 TEXT,
    content_sha256 TEXT
);

CREATE INDEX IF NOT EXISTS idx_cards_created_at
ON cards(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cards_uploader_uuid
ON cards(uploader_uuid);

CREATE TABLE IF NOT EXISTS card_downloads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    actor_name TEXT NOT NULL,
    actor_uuid TEXT NOT NULL,
    downloaded_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_card_downloads_card_id
ON card_downloads(card_id);

CREATE INDEX IF NOT EXISTS idx_card_downloads_actor_uuid
ON card_downloads(actor_uuid);

CREATE TABLE IF NOT EXISTS card_comments (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    author_name TEXT NOT NULL,
    author_uuid TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_card_comments_card_created
ON card_comments(card_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_card_comments_author_created
ON card_comments(author_uuid, created_at DESC);
"#;

pub fn initialize(path: &Path) -> rusqlite::Result<()> {
    let connection = Connection::open(path)?;
    connection.execute_batch(INITIAL_SCHEMA)?;
    ensure_column(&connection, "cards", "file_sha256", "TEXT")?;
    ensure_column(&connection, "cards", "content_sha256", "TEXT")?;
    connection.execute_batch(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_file_sha256
         ON cards(file_sha256) WHERE file_sha256 IS NOT NULL;
         CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_content_sha256
         ON cards(content_sha256) WHERE content_sha256 IS NOT NULL;",
    )?;
    Ok(())
}

fn ensure_column(
    connection: &Connection,
    table: &str,
    column: &str,
    data_type: &str,
) -> rusqlite::Result<()> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if !columns.iter().any(|name| name == column) {
        connection.execute_batch(&format!(
            "ALTER TABLE {table} ADD COLUMN {column} {data_type}"
        ))?;
    }
    Ok(())
}

pub fn verify(path: &Path) -> rusqlite::Result<()> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    connection.query_row(
        "SELECT version FROM schema_meta ORDER BY version DESC LIMIT 1",
        [],
        |_| Ok(()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initialization_is_repeatable_and_verifiable() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("community.sqlite3");

        initialize(&path).unwrap();
        initialize(&path).unwrap();
        verify(&path).unwrap();
    }

    #[test]
    fn persists_upload_and_download_timestamps() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("community.sqlite3");
        initialize(&path).unwrap();

        let connection = Connection::open(&path).unwrap();
        connection
            .execute(
                "INSERT INTO cards (
                    id, title, description, file_name, mime_type, file_size,
                    uploader_name, uploader_uuid, created_at
                 ) VALUES ('card-1', 'Card', '', 'card-1.png', 'image/png', 8,
                           'author', '00000000-0000-4000-8000-000000000001', 100)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO card_downloads (
                    card_id, actor_name, actor_uuid, downloaded_at
                 ) VALUES ('card-1', 'reader',
                           '00000000-0000-4000-8000-000000000002', 200)",
                [],
            )
            .unwrap();

        let (created_at, downloaded_at): (i64, i64) = connection
            .query_row(
                "SELECT cards.created_at, MAX(card_downloads.downloaded_at)
                 FROM cards
                 JOIN card_downloads ON card_downloads.card_id = cards.id
                 WHERE cards.id = 'card-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(created_at, 100);
        assert_eq!(downloaded_at, 200);
    }

    #[test]
    fn migrates_hash_columns_and_comment_store() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("community.sqlite3");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE cards (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    file_name TEXT NOT NULL UNIQUE,
                    mime_type TEXT NOT NULL,
                    file_size INTEGER NOT NULL,
                    uploader_name TEXT NOT NULL,
                    uploader_uuid TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    download_count INTEGER NOT NULL DEFAULT 0
                );",
            )
            .unwrap();
        drop(connection);

        initialize(&path).unwrap();
        let connection = Connection::open(&path).unwrap();
        let columns = connection
            .prepare("PRAGMA table_info(cards)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert!(columns.contains(&"file_sha256".to_owned()));
        assert!(columns.contains(&"content_sha256".to_owned()));
        let comments_table: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'table' AND name = 'card_comments'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(comments_table, 1);
    }
}
