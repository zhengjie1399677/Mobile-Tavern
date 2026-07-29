//! 密钥管理与解密：将 AES-256-GCM 解密逻辑下沉到 Rust 侧。
//!
//! 设计目的：
//! - 剥离 JS bundle 中的 AES key 字符串（原 keyManager.ts 中 `0123456789abcdef` × 4 的拼接）。
//! - 前端通过 `invoke('decrypt_trial_key', { ... })` 调用，仅持有解密后的明文 key。
//! - 注意：Rust 常量字符串在编译后二进制中仍可被 `strings` 工具提取；此方案提升的是
//!   门槛（需反编译 .so / .dll），而非绝对安全。如需更强保护，应改用 Keystore /
//!   Stronghold 等系统级密钥存储（参考 P0-B 方案 B3）。
//!
//! 安全边界：
//! - 此 AES key 仅用于解密云端下发的临时 trial key 密文，**不**用于任何用户数据加密。
//! - 解密结果（明文 trial key）仍在前端 fetch 调用中使用，无法防御前端 hook fetch
//!   的攻击者；如需根治 trial 滥用需将整个 LLM 请求代理下沉到 Rust（参考 P3 方案）。

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use serde::{Deserialize, Serialize};

/// AES-256-GCM 密钥（hex 编码，32 字节 = 64 字符）。
///
/// 历史：原 keyManager.ts 中以 `const p = "0123456789abcdef"; return p + p + p + p;`
/// 形式硬编码并注释"避免静态扫描"。实际拼接后等同于此处常量。下沉到 Rust 后
/// JS bundle 不再含此字符串，提升门槛。
const AES_KEY_HEX: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

/// 解密请求：与原 `keyManager.ts#decryptAesGcm` 入参字段对齐，均为 hex 编码。
#[derive(Serialize, Deserialize)]
pub struct DecryptTrialKeyRequest {
    /// AES-GCM 密文（不含 tag）
    pub ciphertext: String,
    /// 初始化向量（12 字节，hex）
    pub iv: String,
    /// 认证 tag（16 字节，hex）
    pub tag: String,
}

/// 解密 trial key 密文。
///
/// 前端调用方式：
/// ```ignore
/// const plaintext = await invoke<string>('decrypt_trial_key', {
///   req: { ciphertext, iv, tag }
/// });
/// ```
///
/// 行为契约：
/// - 成功返回解密后的明文（UTF-8 字符串，即 OpenRouter API key）。
/// - 失败返回 `Err(String)`，错误信息包含失败原因（hex 解析失败 / AES 解密失败 /
///   UTF-8 转换失败），便于前端透传给用户。
#[tauri::command]
pub fn decrypt_trial_key(req: DecryptTrialKeyRequest) -> Result<String, String> {
    let key_bytes = hex::decode(AES_KEY_HEX)
        .map_err(|e| format!("Invalid AES key hex: {}", e))?;
    let cipher_bytes = hex::decode(&req.ciphertext)
        .map_err(|e| format!("Invalid ciphertext hex: {}", e))?;
    let iv_bytes = hex::decode(&req.iv)
        .map_err(|e| format!("Invalid iv hex: {}", e))?;
    let tag_bytes = hex::decode(&req.tag)
        .map_err(|e| format!("Invalid tag hex: {}", e))?;

    // 与 Web Crypto API 对齐：ciphertext 与 tag 拼接后传入 decrypt。
    let mut combined = Vec::with_capacity(cipher_bytes.len() + tag_bytes.len());
    combined.extend_from_slice(&cipher_bytes);
    combined.extend_from_slice(&tag_bytes);

    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&iv_bytes);

    let plaintext = cipher
        .decrypt(nonce, combined.as_ref())
        .map_err(|e| format!("AES-GCM decrypt failed: {}", e))?;

    String::from_utf8(plaintext)
        .map_err(|e| format!("Decrypted bytes are not valid UTF-8: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 端到端回路测试：使用与前端 keyManager.ts 完全一致的入参格式，
    /// 验证 Rust 侧解密结果与原始明文一致。
    ///
    /// 注意：此测试依赖一个真实的"密文 + iv + tag"三元组。为避免在源码中
    /// 暴露真实 trial key 密文，此处使用一个由已知 key 加密的测试向量，
    /// 而非生产环境的真实密文。
    #[test]
    fn test_decrypt_trial_key_round_trip() {
        // 构造一个测试向量：明文 → AES-GCM 加密 → 调用 decrypt_trial_key → 验证明文一致
        use aes_gcm::aead::{rand_core::RngCore, OsRng};

        let key_bytes = hex::decode(AES_KEY_HEX).unwrap();
        let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
        let cipher = Aes256Gcm::new(key);

        // GCM nonce 固定 12 字节
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let plaintext = b"sk-or-v1-test-key-for-round-trip-verification";
        let combined = cipher
            .encrypt(&nonce, plaintext.as_ref())
            .expect("encrypt should succeed");

        // 拆分 ciphertext + tag（AES-GCM tag 固定 16 字节）
        let tag_len = 16;
        let ct_len = combined.len() - tag_len;
        let ciphertext_hex = hex::encode(&combined[..ct_len]);
        let iv_hex = hex::encode(nonce);
        let tag_hex = hex::encode(&combined[ct_len..]);

        let req = DecryptTrialKeyRequest {
            ciphertext: ciphertext_hex,
            iv: iv_hex,
            tag: tag_hex,
        };

        let result = decrypt_trial_key(req).expect("decrypt should succeed");
        assert_eq!(result.as_bytes(), plaintext);
    }

    /// 错误路径：篡改 tag 应导致解密失败而非返回垃圾数据。
    #[test]
    fn test_decrypt_trial_key_tamper_detection() {
        use aes_gcm::aead::{rand_core::RngCore, OsRng};

        let key_bytes = hex::decode(AES_KEY_HEX).unwrap();
        let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
        let cipher = Aes256Gcm::new(key);

        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let plaintext = b"sk-or-v1-test";
        let mut combined = cipher
            .encrypt(&nonce, plaintext.as_ref())
            .expect("encrypt should succeed");

        // 篡改最后一个字节（破坏 tag）
        let last = combined.len() - 1;
        combined[last] ^= 0xff;

        let tag_len = 16;
        let ct_len = combined.len() - tag_len;
        let ciphertext_hex = hex::encode(&combined[..ct_len]);
        let iv_hex = hex::encode(nonce);
        let tag_hex = hex::encode(&combined[ct_len..]);

        let req = DecryptTrialKeyRequest {
            ciphertext: ciphertext_hex,
            iv: iv_hex,
            tag: tag_hex,
        };

        let result = decrypt_trial_key(req);
        assert!(result.is_err(), "tampered ciphertext must fail decryption");
    }
}
