use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::Value;
use sha2::{Digest, Sha256};

pub struct CardHashes {
    pub file_sha256: String,
    pub content_sha256: String,
}

pub fn calculate(bytes: &[u8], mime_type: &str) -> Result<CardHashes, String> {
    let file_sha256 = hex_digest(bytes);
    let json_bytes = if mime_type == "application/json" {
        bytes.to_vec()
    } else {
        extract_png_character_json(bytes)?
    };
    let mut value: Value =
        serde_json::from_slice(&json_bytes).map_err(|_| "角色卡 JSON 无法解析".to_owned())?;
    remove_volatile_fields(&mut value);
    let normalized = serde_json::to_vec(&value).map_err(|_| "角色卡内容无法规范化".to_owned())?;
    Ok(CardHashes {
        file_sha256,
        content_sha256: hex_digest(&normalized),
    })
}

fn hex_digest(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn remove_volatile_fields(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for key in [
                "avatar",
                "image",
                "file_name",
                "filename",
                "created_at",
                "updated_at",
                "create_date",
                "modification_date",
            ] {
                map.remove(key);
            }
            for child in map.values_mut() {
                remove_volatile_fields(child);
            }
        }
        Value::Array(items) => {
            for item in items {
                remove_volatile_fields(item);
            }
        }
        _ => {}
    }
}

fn extract_png_character_json(bytes: &[u8]) -> Result<Vec<u8>, String> {
    const SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    if bytes.len() < 8 || &bytes[..8] != SIGNATURE {
        return Err("PNG 文件签名无效".to_owned());
    }
    let mut offset = 8;
    while offset + 12 <= bytes.len() {
        let length = u32::from_be_bytes(
            bytes[offset..offset + 4]
                .try_into()
                .map_err(|_| "PNG 数据损坏".to_owned())?,
        ) as usize;
        let chunk_end = offset + 12 + length;
        if chunk_end > bytes.len() {
            return Err("PNG 数据不完整".to_owned());
        }
        let chunk_type = &bytes[offset + 4..offset + 8];
        let data = &bytes[offset + 8..offset + 8 + length];
        if chunk_type == b"tEXt" {
            if let Some(separator) = data.iter().position(|byte| *byte == 0) {
                if &data[..separator] == b"chara" {
                    return STANDARD
                        .decode(&data[separator + 1..])
                        .map_err(|_| "PNG 角色卡元数据不是有效 Base64".to_owned());
                }
            }
        }
        if chunk_type == b"IEND" {
            break;
        }
        offset = chunk_end;
    }
    Err("PNG 中缺少 chara 角色卡元数据".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_volatile_fields_for_content_hash() {
        let first = br#"{"name":"A","avatar":"one","data":{"description":"same"}}"#;
        let second = br#"{"data":{"description":"same"},"avatar":"two","name":"A"}"#;
        let first_hash = calculate(first, "application/json").unwrap();
        let second_hash = calculate(second, "application/json").unwrap();
        assert_ne!(first_hash.file_sha256, second_hash.file_sha256);
        assert_eq!(first_hash.content_sha256, second_hash.content_sha256);
    }
}
