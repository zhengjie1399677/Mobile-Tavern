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
    download_count INTEGER NOT NULL DEFAULT 0
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
"#;

pub fn initialize(path: &Path) -> rusqlite::Result<()> {
    let connection = Connection::open(path)?;
    connection.execute_batch(INITIAL_SCHEMA)?;
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
}
