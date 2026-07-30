// === Crypto Helpers for API Key Security ===

let cachedCryptoKey: CryptoKey | null = null;
let cryptoKeyPromise: Promise<CryptoKey> | null = null;

/**
 * 测试专用：重置模块级 crypto key 缓存。
 *
 * 必须与 localDB.__resetDBInstanceForTesting 配套调用，否则：
 *   - 若前序测试在 cryptoKeyPromise 未 resolve 时中断，pending Promise 会泄漏到后续测试
 *   - 后续 saveStoredSettings/getStoredSettings 调用 getOrCreateCryptoKey 时
 *     直接返回 pending Promise，导致 await 永久挂起 → enqueueWrite 15s 超时 → 测试 flaky
 *   - 即使 cachedCryptoKey 已设置，跨测试复用同一密钥也会导致解密结果不一致
 */
export function __resetCryptoKeyForTesting(): void {
  cachedCryptoKey = null;
  cryptoKeyPromise = null;
}

export async function getOrCreateCryptoKey(db: IDBDatabase): Promise<CryptoKey> {
  if (cachedCryptoKey) return cachedCryptoKey;
  if (cryptoKeyPromise) return cryptoKeyPromise;

  const readStoredKey = (): Promise<CryptoKey | undefined> => new Promise((resolve, reject) => {
    const transaction = db.transaction("settings", "readonly");
    const store = transaction.objectStore("settings");
    const request = store.get("api_crypto_key");

    request.onsuccess = () => resolve(request.result as CryptoKey | undefined);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error || new Error("CryptoKey read transaction aborted"));
  });

  const persistKey = (key: CryptoKey): Promise<void> => new Promise((resolve, reject) => {
    // CryptoKey 生成是异步操作，必须在其完成后新开事务。复用读取事务会因
    // IndexedDB 自动提交而触发 TransactionInactiveError。
    const transaction = db.transaction("settings", "readwrite");
    const store = transaction.objectStore("settings");
    const request = store.put(key, "api_crypto_key");

    request.onerror = () => reject(request.error || new Error("Failed to persist CryptoKey"));
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("CryptoKey write transaction aborted"));
    transaction.onerror = () => reject(transaction.error || new Error("CryptoKey write transaction failed"));
  });

  cryptoKeyPromise = (async () => {
    try {
      const storedKey = await readStoredKey();
      if (storedKey) {
        cachedCryptoKey = storedKey;
        return storedKey;
      }

      const newKey = await crypto.subtle.generateKey(
        {
          name: "AES-GCM",
          length: 256,
        },
        false,
        ["encrypt", "decrypt"],
      );
      await persistKey(newKey);
      cachedCryptoKey = newKey;
      return newKey;
    } catch (error: unknown) {
      cryptoKeyPromise = null;
      throw error;
    }
  })();

  return cryptoKeyPromise;
}

const ENC_PREFIX = "enc_aes_gcm:";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function encryptValue(plainText: string, key: CryptoKey): Promise<string> {
  if (!plainText) return "";
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const data = encoder.encode(plainText);

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    data
  );

  const ivBase64 = arrayBufferToBase64(iv.buffer);
  const cipherBase64 = arrayBufferToBase64(ciphertext);

  return `${ENC_PREFIX}${ivBase64}:${cipherBase64}`;
}

export async function decryptValue(encryptedText: string, key: CryptoKey): Promise<string> {
  if (!encryptedText) return "";
  if (!encryptedText.startsWith(ENC_PREFIX)) return encryptedText;

  try {
    const parts = encryptedText.substring(ENC_PREFIX.length).split(":");
    if (parts.length !== 2) {
      throw new Error("Invalid encrypted format");
    }
    const iv = new Uint8Array(base64ToArrayBuffer(parts[0]));
    const ciphertext = base64ToArrayBuffer(parts[1]);

    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      key,
      ciphertext
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (err) {
    console.error("[localDB] Decryption failed, falling back to empty string:", err);
    return "";
  }
}

