//! 密码哈希与校验
//!
//! 使用 argon2id（OWASP 推荐算法），默认参数满足 2024+ 安全要求。
//! 哈希结果为 PHC 字符串格式（含盐、迭代次数、哈希值），存 VARCHAR(255)。

use argon2::password_hash::{
    rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
};
use argon2::Argon2;

use crate::error::{AppError, AppResult};

/// 哈希明文密码
///
/// 返回 PHC 格式字符串（例：`$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`）。
/// 每次调用生成独立盐，相同密码产生不同哈希。
pub fn hash_password(plain: &str) -> AppResult<String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(plain.as_bytes(), &salt)
        .map_err(|e| AppError::PasswordHash(e.to_string()))?
        .to_string();
    Ok(hash)
}

/// 校验明文密码与哈希是否匹配
///
/// 返回 `Ok(true)` 匹配 / `Ok(false)` 不匹配 / `Err` 哈希格式损坏。
pub fn verify_password(plain: &str, hash: &str) -> AppResult<bool> {
    let parsed = PasswordHash::new(hash)
        .map_err(|e| AppError::PasswordHash(format!("哈希格式损坏: {e}")))?;
    Ok(Argon2::default()
        .verify_password(plain.as_bytes(), &parsed)
        .is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_and_verify_roundtrip() {
        let plain = "correct horse battery staple";
        let hash = hash_password(plain).unwrap();
        assert!(verify_password(plain, &hash).unwrap());
    }

    #[test]
    fn verify_wrong_password_fails() {
        let hash = hash_password("password123").unwrap();
        assert!(!verify_password("wrong_password", &hash).unwrap());
    }

    #[test]
    fn hash_is_unique_due_to_salt() {
        let plain = "same_password";
        let h1 = hash_password(plain).unwrap();
        let h2 = hash_password(plain).unwrap();
        assert_ne!(h1, h2, "相同密码的两次哈希应因盐不同而不同");
        assert!(verify_password(plain, &h1).unwrap());
        assert!(verify_password(plain, &h2).unwrap());
    }

    #[test]
    fn malformed_hash_returns_error() {
        let result = verify_password("any", "not_a_valid_hash");
        assert!(result.is_err());
    }

    #[test]
    fn hash_output_within_255_chars() {
        // DB 列为 VARCHAR(255)，确认 PHC 字符串不超限
        let hash = hash_password("test").unwrap();
        assert!(hash.len() <= 255, "哈希长度 {} 超过 255", hash.len());
    }
}