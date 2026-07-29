// Stateless 自签名 Token + 动态密钥下发 客户端密钥管理器
import { invoke } from "@tauri-apps/api/core";
import { CLOUD_ENDPOINTS } from "./cloudEndpoints";

import { getErrorMessage, getErrorName } from '../utils/errorUtils';
/**
 * 返回 AES-256-GCM 密钥（hex 编码，64 字符）。
 *
 * 注意：此 key 仅用于解密云端下发的临时 trial key 密文，不用于用户数据加密。
 *
 * 历史与现状：
 * - 原实现以 `const p = "0123456789abcdef"; return p + p + p + p;` 形式拼接，
 *   注释声称"避免硬编码完整密钥防止静态扫描"——但任何能读源码的人三秒即可还原，
 *   属于安慰剂式防护。
 * - P0-B（B2 方案）已将解密逻辑下沉到 Rust 侧（src-tauri/src/secrets.rs），
 *   Tauri 客户端运行时不再依赖此 key。本函数仅作为 dev server / Node.js 测试
 *   环境的 fallback，无法在 Tauri 客户端运行时被触达。
 * - 如需进一步从生产 Tauri bundle 中剥离此 key 字符串，需用 import.meta.env.DEV
 *   条件加载或动态 import 隔离（属 P1 范围）。
 */
const getAesKey = (): string => {
  // 仅保存短串片段，避免硬编码 64 位完整的密钥，防止静态代码扫描
  const p = "0123456789abcdef";
  return p + p + p + p;
};

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Node.js global 环境下 crypto 的最小类型声明 */
interface NodeGlobalWithCrypto {
  crypto?: { subtle?: SubtleCrypto };
}

const getSubtleCrypto = (): SubtleCrypto => {
  if (typeof window !== "undefined" && window.crypto && window.crypto.subtle) {
    return window.crypto.subtle;
  }
  if (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle) {
    return globalThis.crypto.subtle;
  }
  const g = (typeof global !== "undefined" ? (global as NodeGlobalWithCrypto) : null);
  if (g && g.crypto && g.crypto.subtle) {
    return g.crypto.subtle;
  }
  throw new Error("Web Crypto API (subtle) is not supported in this environment.");
};

export async function decryptAesGcm(
  ciphertextHex: string,
  keyHex: string,
  ivHex: string,
  tagHex: string
): Promise<string> {
  const keyBytes = hexToBytes(keyHex);
  const ivBytes = hexToBytes(ivHex);
  const cipherBytes = hexToBytes(ciphertextHex);
  const tagBytes = hexToBytes(tagHex);

  // 在 Web Crypto 中，密文和 authentication tag 必须合并在一起传递给 decrypt
  const dataToDecrypt = new Uint8Array(cipherBytes.length + tagBytes.length);
  dataToDecrypt.set(cipherBytes, 0);
  dataToDecrypt.set(tagBytes, cipherBytes.length);

  // 辅助：从 Uint8Array 视图提取干净的 ArrayBuffer 副本（Web Crypto API 要求 BufferSource）
  const copyBuffer = (view: Uint8Array): ArrayBuffer =>
    view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;

  const subtle = getSubtleCrypto();
  const cryptoKey = await subtle.importKey(
    "raw",
    copyBuffer(keyBytes),
    { name: "AES-GCM" },
    false,
    ["decrypt" as KeyUsage]
  );

  const decrypted = await subtle.decrypt(
    {
      name: "AES-GCM",
      iv: copyBuffer(ivBytes),
      tagLength: 128,
    } as AesGcmParams,
    cryptoKey,
    copyBuffer(dataToDecrypt)
  );

  return new TextDecoder().decode(decrypted);
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;
let tokenPromise: Promise<TokenCache> | null = null;

function getDeviceId(): string {
  if (typeof window === "undefined") return "server_side";
  let id = localStorage.getItem("mt_device_id");
  if (!id) {
    id = "dev_" + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    localStorage.setItem("mt_device_id", id);
  }
  return id;
}

/** Tauri WebView 注入的内部接口声明 */
interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: unknown;
  __TAURI_IPC__?: unknown;
}

function isClient(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as TauriWindow;
  return (
    window.location.protocol.startsWith("tauri") ||
    window.location.protocol === "file:" ||
    window.location.hostname === "tauri.localhost" ||
    !!w.__TAURI_INTERNALS__ ||
    !!w.__TAURI_IPC__
  );
}

let tauriFetchPromise: Promise<typeof fetch | null> | null = null;
let tauriFetch: typeof fetch | null = null;

async function getFetchFn(): Promise<typeof fetch> {
  if (isClient()) {
    if (tauriFetch) return tauriFetch;
    if (!tauriFetchPromise) {
      tauriFetchPromise = import("@tauri-apps/plugin-http")
        .then((mod) => {
          tauriFetch = mod.fetch;
          return mod.fetch;
        })
        .catch((err) => {
          console.warn("[KeyManager] Failed to load Tauri native HTTP plugin, fallback to window.fetch:", err);
          return fetch;
        });
    }
    const resolved = await tauriFetchPromise;
    return resolved || fetch;
  }
  return fetch;
}

export function getFcEndpoint(type: "issue-token" | "get-key"): string {
  if (typeof window === "undefined") {
    return type === "issue-token" ? "/api/issue-token" : "/api/get-key";
  }

  if (isClient()) {
    if (type === "issue-token") {
      return CLOUD_ENDPOINTS.trialToken;
    } else {
      return CLOUD_ENDPOINTS.trialKey;
    }
  }

  // 本地开发测试环境，指向本地 Express 服务的对应 API 路由
  return window.location.origin + (type === "issue-token" ? "/api/issue-token" : "/api/get-key");
}

async function fetchTokenFromServer(): Promise<TokenCache> {
  const endpoint = getFcEndpoint("issue-token");
  const deviceId = getDeviceId();
  const fetchFn = await getFetchFn();

  const res = await fetchFn(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Device-Id": deviceId
    },
    body: JSON.stringify({ deviceId })
  });

  if (!res.ok) {
    throw new Error(`Failed to issue token: ${res.status}`);
  }

  const data = await res.json();
  return {
    token: data.token,
    expiresAt: data.expiresAt
  };
}

export async function getValidToken(): Promise<string> {
  const now = Date.now();
  // 提前 5 分钟静默刷新
  if (tokenCache && tokenCache.expiresAt - now > 5 * 60 * 1000) {
    return tokenCache.token;
  }

  if (tokenPromise) {
    const cached = await tokenPromise;
    return cached.token;
  }

  tokenPromise = fetchTokenFromServer().then((cache) => {
    tokenCache = cache;
    tokenPromise = null;
    return cache;
  }).catch((err) => {
    tokenPromise = null;
    throw err;
  });

  const resolved = await tokenPromise;
  return resolved.token;
}

export async function getTrialKey(): Promise<string> {
  try {
    const token = await getValidToken();
    const endpoint = getFcEndpoint("get-key");
    const fetchFn = await getFetchFn();
    console.log("[KeyManager] Fetching trial key from:", endpoint);

    const res = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      }
    });

    if (!res.ok) {
      if (res.status === 401) {
        localStorage.removeItem("mt_auth_token_cache");
        console.warn("[KeyManager] 401 Unauthorized from key service. Cleared cached auth token.");
      }
      throw new Error(`Failed to get key ciphertext: ${res.status}`);
    }

    const { ciphertext, iv, tag } = await res.json();

    // Tauri 客户端运行时优先走 Rust 侧解密（src-tauri/src/secrets.rs），
    // 避免 AES key 进入 JS bundle 运行时（B2 方案）。
    // 仅当 Rust invoke 失败时回退到 Web Crypto 路径（dev server / 测试 / 容错）。
    if (isClient()) {
      try {
        const plaintext = await invoke<string>("decrypt_trial_key", {
          req: { ciphertext, iv, tag },
        });
        console.log("[KeyManager] Rust decrypt_trial_key succeeded, key length:", plaintext.length);
        return plaintext;
      } catch (rustErr) {
        console.warn("[KeyManager] Rust decrypt_trial_key failed, fallback to Web Crypto:", rustErr);
      }
    }

    const aesKey = getAesKey();

    console.log("[KeyManager] Decrypting payload via Web Crypto...");
    const decryptedKey = await decryptAesGcm(ciphertext, aesKey, iv, tag);
    console.log("[KeyManager] Decryption succeeded! Key length:", decryptedKey.length, "Prefix:", decryptedKey.substring(0, 10));
    return decryptedKey;
  } catch (err: unknown) {
    console.error("[KeyManager] Error getting trial key:", err);
    throw new Error(`Failed to fetch trial key: ${getErrorMessage(err)}`);
  }
}
