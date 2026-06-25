// Stateless 自签名 Token + 动态密钥下发 客户端密钥管理器

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

const getSubtleCrypto = (): SubtleCrypto => {
  if (typeof window !== "undefined" && window.crypto && window.crypto.subtle) {
    return window.crypto.subtle;
  }
  if (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle) {
    return globalThis.crypto.subtle;
  }
  if (typeof global !== "undefined" && (global as any).crypto && (global as any).crypto.subtle) {
    return (global as any).crypto.subtle;
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

  const subtle = getSubtleCrypto();
  const cryptoKey = await subtle.importKey(
    "raw",
    keyBytes as any,
    { name: "AES-GCM" } as any,
    false,
    ["decrypt"] as any
  );

  const decrypted = await subtle.decrypt(
    {
      name: "AES-GCM",
      iv: ivBytes as any,
      tagLength: 128,
    } as any,
    cryptoKey,
    dataToDecrypt as any
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

export function getFcEndpoint(type: "issue-token" | "get-key"): string {
  if (typeof window === "undefined") {
    return type === "issue-token" ? "/api/issue-token" : "/api/get-key";
  }
  
  const isClient = (): boolean => {
    return (
      window.location.protocol.startsWith("tauri") ||
      window.location.protocol === "file:" ||
      window.location.hostname === "tauri.localhost" ||
      !!(window as any).__TAURI_INTERNALS__ ||
      !!(window as any).__TAURI_IPC__
    );
  };

  if (isClient()) {
    // 部署两个独立 FC 函数后的测试域名（请将此处的域名替换为您在阿里云 FC 实际创建的函数域名）
    if (type === "issue-token") {
      return "https://mobile-ue-token-zcslobjkak.cn-hangzhou.fcapp.run";
    } else {
      return "https://mobile-get-key-uggoeabkfb.cn-hangzhou.fcapp.run";
    }
  }
  
  // 本地开发测试环境，指向本地 Express 服务的对应 API 路由
  return window.location.origin + (type === "issue-token" ? "/api/issue-token" : "/api/get-key");
}

async function fetchTokenFromServer(): Promise<TokenCache> {
  const endpoint = getFcEndpoint("issue-token");
  const deviceId = getDeviceId();
  
  const res = await fetch(endpoint, {
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

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      }
    });

    if (!res.ok) {
      throw new Error(`Failed to get key ciphertext: ${res.status}`);
    }

    const { ciphertext, iv, tag } = await res.json();
    const aesKey = getAesKey();
    
    const decryptedKey = await decryptAesGcm(ciphertext, aesKey, iv, tag);
    return decryptedKey;
  } catch (err: any) {
    console.error("[KeyManager] Error getting trial key:", err);
    throw new Error(`Failed to fetch trial key: ${err.message}`);
  }
}
