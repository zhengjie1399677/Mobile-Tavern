import {
  CharacterCard,
  ChatSession,
  UserSettings,
  LorebookEntry,
} from "../types";

// ===== API Key 加密/解密工具 =====
// 使用 AES-256-GCM 对 API Key 进行加密存储，密钥从设备 ID 派生，设备绑定

const API_KEY_MAGIC = "ak_v1:"; // 版本标识，区分明文/密文

async function deriveEncryptionKey(): Promise<CryptoKey> {
  // 使用设备上的稳定标识符 + 固定盐值派生出 AES-256 密钥
  const DEVICE_SALT_KEY = "mt_ak_salt";
  let salt = localStorage.getItem(DEVICE_SALT_KEY);
  if (!salt) {
    salt = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    localStorage.setItem(DEVICE_SALT_KEY, salt);
  }

  // 组合设备 ID 和域名作为密钥素材
  const keyMaterial = `${navigator.userAgent}|${navigator.language}|mt_secure_key`;
  const enc = new TextEncoder();
  const keyBase = await crypto.subtle.importKey(
    "raw",
    enc.encode(keyMaterial),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode(salt),
      iterations: 200000,
      hash: "SHA-256",
    },
    keyBase,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptApiKey(plaintext: string): Promise<string> {
  if (!plaintext) return "";
  try {
    const key = await deriveEncryptionKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      enc.encode(plaintext),
    );
    // 格式: magic + iv(hex) + ciphertext(hex)
    const ivHex = Array.from(iv).map((b) => b.toString(16).padStart(2, "0")).join("");
    const ctHex = Array.from(new Uint8Array(ciphertext)).map((b) => b.toString(16).padStart(2, "0")).join("");
    return API_KEY_MAGIC + ivHex + ctHex;
  } catch {
    // 加密失败时回退明文（极端情况，如旧浏览器不支持 Web Crypto）
    return plaintext;
  }
}

async function decryptApiKey(wrapped: string): Promise<string> {
  if (!wrapped) return "";
  // 明文兼容：不带 magic 前缀的表示旧版未加密数据
  if (!wrapped.startsWith(API_KEY_MAGIC)) {
    return wrapped;
  }
  try {
    const hexStr = wrapped.slice(API_KEY_MAGIC.length);
    // 前 24 个 hex 字符 = 12 字节 IV
    const ivHex = hexStr.slice(0, 24);
    const ctHex = hexStr.slice(24);

    const iv = new Uint8Array(12);
    for (let i = 0; i < 12; i++) {
      iv[i] = parseInt(ivHex.substring(i * 2, i * 2 + 2), 16);
    }

    const ctBytes = new Uint8Array(ctHex.length / 2);
    for (let i = 0; i < ctHex.length; i += 2) {
      ctBytes[i / 2] = parseInt(ctHex.substring(i, i + 2), 16);
    }

    const key = await deriveEncryptionKey();
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ctBytes,
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    // 解密失败：可能换了设备/浏览器，返回空字符串让用户重新输入
    return "";
  }
}

const DB_NAME = "MobileTavernLiteDB";
const DB_VERSION = 1;

let dbInstance: IDBDatabase | null = null;

export function getDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(request.result);
    };

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = request.result;

      // Store 1: Character Cards
      if (!db.objectStoreNames.contains("characters")) {
        db.createObjectStore("characters", { keyPath: "id" });
      }

      // Store 2: Chat Sessions
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "id" });
      }

      // Store 3: Settings & Presets (Key-value setup)
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings");
      }
    };
  });
}

// === Characters CRUD ===

export async function getAllCharacters(): Promise<CharacterCard[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("characters", "readonly");
    const store = transaction.objectStore("characters");
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function saveCharacter(character: CharacterCard): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("characters", "readwrite");
    const store = transaction.objectStore("characters");
    const request = store.put(character);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function deleteCharacter(id: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("characters", "readwrite");
    const store = transaction.objectStore("characters");
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// === Sessions CRUD ===

export async function getAllSessions(): Promise<ChatSession[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sessions", "readonly");
    const store = transaction.objectStore("sessions");
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function saveSession(session: ChatSession): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sessions", "readwrite");
    const store = transaction.objectStore("sessions");
    const request = store.put(session);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function deleteSession(id: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sessions", "readwrite");
    const store = transaction.objectStore("sessions");
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// === Settings Helper ===

export async function getStoredSettings(): Promise<UserSettings | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("settings", "readonly");
    const store = transaction.objectStore("settings");
    const request = store.get("user_settings");

    request.onsuccess = async () => {
      const raw = request.result;
      if (!raw) return resolve(null);
      // 解密 API Key
      if (raw.api?.apiKey) {
        raw.api = { ...raw.api, apiKey: await decryptApiKey(raw.api.apiKey) };
      }
      resolve(raw);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function saveStoredSettings(
  settings: UserSettings,
): Promise<void> {
  const db = await getDB();
  // 深拷贝并加密 API Key 后再写入
  const toStore = JSON.parse(JSON.stringify(settings));
  if (toStore.api?.apiKey) {
    toStore.api.apiKey = await encryptApiKey(toStore.api.apiKey);
  }
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("settings", "readwrite");
    const store = transaction.objectStore("settings");
    const request = store.put(toStore, "user_settings");

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getGlobalLorebook(): Promise<LorebookEntry[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("settings", "readonly");
    const store = transaction.objectStore("settings");
    const request = store.get("global_lorebook");

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function saveGlobalLorebook(
  entries: LorebookEntry[],
): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("settings", "readwrite");
    const store = transaction.objectStore("settings");
    const request = store.put(entries, "global_lorebook");

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
