// === Crypto Helpers for API Key Security ===

let cachedCryptoKey: CryptoKey | null = null;
let cryptoKeyPromise: Promise<CryptoKey> | null = null;

export async function getOrCreateCryptoKey(db: IDBDatabase): Promise<CryptoKey> {
  if (cachedCryptoKey) return cachedCryptoKey;
  if (cryptoKeyPromise) return cryptoKeyPromise;

  cryptoKeyPromise = new Promise<CryptoKey>((resolve, reject) => {
    const transaction = db.transaction("settings", "readwrite");
    const store = transaction.objectStore("settings");
    const request = store.get("api_crypto_key");

    request.onsuccess = async () => {
      let key = request.result as CryptoKey | undefined;
      if (key) {
        cachedCryptoKey = key;
        resolve(key);
      } else {
        try {
          const newKey = await crypto.subtle.generateKey(
            {
              name: "AES-GCM",
              length: 256,
            },
            false, // Non-extractable for security
            ["encrypt", "decrypt"]
          );
          const putRequest = store.put(newKey, "api_crypto_key");
          putRequest.onsuccess = () => {
            cachedCryptoKey = newKey;
            resolve(newKey);
          };
          putRequest.onerror = () => {
            console.error("[localDB] Failed to save CryptoKey to IndexedDB settings:", putRequest.error);
            resolve(newKey);
          };
        } catch (err) {
          // DATA-03: 失败后重置 cryptoKeyPromise，允许后续重试，避免功能永久阻塞
          cryptoKeyPromise = null;
          reject(err);
        }
      }
    };

    request.onerror = () => {
      // DATA-03: 失败后重置 cryptoKeyPromise，允许后续重试
      cryptoKeyPromise = null;
      reject(request.error);
    };

    // DATA-01: 事务被中断时同样需要重置并 reject
    transaction.onabort = () => {
      cryptoKeyPromise = null;
      reject(transaction.error || new Error("Transaction aborted"));
    };
  });

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

