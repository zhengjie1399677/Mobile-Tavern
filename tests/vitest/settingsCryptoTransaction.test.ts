import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetCryptoKeyForTesting,
  decryptValue,
  encryptValue,
  getOrCreateCryptoKey,
} from "../../src/infrastructure/storage/settingsCrypto";

function openSettingsDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("settings");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readStoredCryptoKey(db: IDBDatabase): Promise<CryptoKey | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("settings", "readonly");
    const request = transaction.objectStore("settings").get("api_crypto_key");
    request.onsuccess = () => resolve(request.result as CryptoKey | undefined);
    request.onerror = () => reject(request.error);
  });
}

describe("settingsCrypto IndexedDB 事务生命周期", () => {
  const openDatabases: IDBDatabase[] = [];

  beforeEach(() => {
    __resetCryptoKeyForTesting();
  });

  afterEach(() => {
    for (const db of openDatabases.splice(0)) {
      db.close();
    }
    __resetCryptoKeyForTesting();
  });

  it("首次异步生成密钥后使用独立事务持久化，并可在缓存重置后读取解密", async () => {
    const db = await openSettingsDatabase(`settings-crypto-${crypto.randomUUID()}`);
    openDatabases.push(db);
    const firstKey = await getOrCreateCryptoKey(db);
    const encrypted = await encryptValue("sk-test-persisted", firstKey);

    __resetCryptoKeyForTesting();
    const restoredKey = await getOrCreateCryptoKey(db);

    expect(await decryptValue(encrypted, restoredKey)).toBe("sk-test-persisted");
  });

  it("同一运行实例的并发请求共享一次密钥创建结果", async () => {
    const db = await openSettingsDatabase(`settings-crypto-concurrent-${crypto.randomUUID()}`);
    openDatabases.push(db);

    const [firstKey, secondKey, thirdKey] = await Promise.all([
      getOrCreateCryptoKey(db),
      getOrCreateCryptoKey(db),
      getOrCreateCryptoKey(db),
    ]);

    expect(secondKey).toBe(firstKey);
    expect(thirdKey).toBe(firstKey);
    expect(await readStoredCryptoKey(db)).toBeDefined();
  });

  it("已有密钥在缓存重置后保持稳定，不覆盖历史密文所依赖的密钥", async () => {
    const db = await openSettingsDatabase(`settings-crypto-existing-${crypto.randomUUID()}`);
    openDatabases.push(db);
    const firstKey = await getOrCreateCryptoKey(db);
    const encrypted = await encryptValue("sk-existing-key", firstKey);

    __resetCryptoKeyForTesting();
    const secondKey = await getOrCreateCryptoKey(db);
    __resetCryptoKeyForTesting();
    const thirdKey = await getOrCreateCryptoKey(db);

    expect(await decryptValue(encrypted, secondKey)).toBe("sk-existing-key");
    expect(await decryptValue(encrypted, thirdKey)).toBe("sk-existing-key");
  });

  it("数据库读取失败后清理共享 Promise，后续调用可以重新尝试", async () => {
    const closedDb = await openSettingsDatabase(`settings-crypto-closed-${crypto.randomUUID()}`);
    closedDb.close();

    await expect(getOrCreateCryptoKey(closedDb)).rejects.toBeDefined();

    const healthyDb = await openSettingsDatabase(`settings-crypto-retry-${crypto.randomUUID()}`);
    openDatabases.push(healthyDb);
    const recoveredKey = await getOrCreateCryptoKey(healthyDb);

    expect(recoveredKey).toBeDefined();
    expect(await readStoredCryptoKey(healthyDb)).toBeDefined();
  });
});
