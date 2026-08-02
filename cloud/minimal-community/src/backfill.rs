use rusqlite::Connection;

use crate::{config::AppConfig, thumbnails};

/// 为缩略图功能上线前已上传的 PNG 角色卡补生成封面缩略图。
///
/// 仅扫描 `mime_type = 'image/png'` 的卡片；已存在缩略图的卡片跳过。
/// 通过 `mobile-tavern-community backfill-thumbnails` 触发，执行后退出。
pub fn run(config: &AppConfig) -> anyhow::Result<()> {
    let database_path = config.database_path();
    let cards_dir = config.cards_dir();
    let thumbnails_dir = config.thumbnails_dir();
    std::fs::create_dir_all(&thumbnails_dir)?;

    let connection = Connection::open(&database_path)?;
    let mut statement = connection.prepare(
        "SELECT id, file_name, thumbnail_file_name
         FROM cards WHERE mime_type = 'image/png'",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
        ))
    })?;

    let mut created = 0usize;
    let mut skipped = 0usize;
    let mut failed = 0usize;

    for row in rows {
        let (id, file_name, existing_thumbnail) = row?;
        let thumbnail_name = format!("{id}.{}", thumbnails::THUMBNAIL_EXTENSION);
        let thumbnail_path = thumbnails_dir.join(&thumbnail_name);
        if existing_thumbnail.is_some() && thumbnail_path.exists() {
            skipped += 1;
            continue;
        }

        let card_path = cards_dir.join(&file_name);
        let png_bytes = match std::fs::read(&card_path) {
            Ok(bytes) => bytes,
            Err(error) => {
                tracing::error!(%error, ?id, "读取角色卡文件失败，跳过回填");
                failed += 1;
                continue;
            }
        };

        match thumbnails::generate_thumbnail(&png_bytes) {
            Ok(jpeg_bytes) => {
                if let Err(error) = std::fs::write(&thumbnail_path, jpeg_bytes) {
                    tracing::error!(%error, ?id, "写入缩略图失败");
                    failed += 1;
                    continue;
                }
                connection.execute(
                    "UPDATE cards SET thumbnail_file_name = ?1 WHERE id = ?2",
                    rusqlite::params![&thumbnail_name, &id],
                )?;
                created += 1;
            }
            Err(message) => {
                tracing::error!(message, ?id, "生成缩略图失败");
                failed += 1;
            }
        }
    }

    tracing::info!(created, skipped, failed, "缩略图回填完成");
    println!("缩略图回填完成：新建 {created}，已存在跳过 {skipped}，失败 {failed}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::io::Cursor;

    fn make_test_png() -> Vec<u8> {
        let mut rgba = image::RgbaImage::new(320, 200);
        for (x, y, pixel) in rgba.enumerate_pixels_mut() {
            *pixel = image::Rgba([(x % 256) as u8, (y % 256) as u8, 180, 255]);
        }
        let mut output = Vec::new();
        rgba.write_to(&mut Cursor::new(&mut output), image::ImageFormat::Png)
            .expect("测试 PNG 编码失败");
        output
    }

    fn test_config(data_dir: &Path) -> AppConfig {
        AppConfig {
            port: 8080,
            data_dir: data_dir.to_path_buf(),
            cors_allowed_origins: Vec::new(),
            max_storage_bytes: 1 << 30,
            max_uploads_per_window: 3,
            upload_window_seconds: 600,
            admin_token: None,
        }
    }

    #[test]
    fn backfills_missing_thumbnails_and_is_idempotent() {
        let directory = tempfile::tempdir().unwrap();
        let config = test_config(directory.path());
        config.ensure_directories().unwrap();
        crate::database::initialize(&config.database_path()).unwrap();
        std::fs::create_dir_all(config.cards_dir()).unwrap();

        let png = make_test_png();
        std::fs::write(config.cards_dir().join("card-1.png"), &png).unwrap();

        let connection = Connection::open(config.database_path()).unwrap();
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
        drop(connection);

        run(&config).unwrap();
        assert!(config.thumbnails_dir().join("card-1.jpg").exists());

        let connection = Connection::open(config.database_path()).unwrap();
        let thumbnail: Option<String> = connection
            .query_row(
                "SELECT thumbnail_file_name FROM cards WHERE id = 'card-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(thumbnail.as_deref(), Some("card-1.jpg"));
        drop(connection);

        // 幂等：二次执行跳过已生成缩略图
        run(&config).unwrap();
    }
}
