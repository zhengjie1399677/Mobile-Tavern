import type {
  InstalledToolPlugin,
  ToolPluginArtifact,
  ToolPluginCredentialStatus,
  ToolPluginManifest,
  ToolPluginPermission,
} from "../../domain/toolPlugins";
import { decryptValue, encryptValue } from "../storage/settingsCrypto";

const DB_NAME = "MobileTavernToolPluginDB";
const DB_VERSION = 2;
const PLUGINS_STORE = "plugins";
const ARTIFACTS_STORE = "artifacts";
const CREDENTIALS_STORE = "credentials";
const META_STORE = "meta";
const CREDENTIAL_KEY_ID = "credential_crypto_key";

let openedDb: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;
let credentialKeyPromise: Promise<CryptoKey> | null = null;

interface StoredCredential {
  key: string;
  pluginId: string;
  credentialId: string;
  encryptedValue: string;
  updatedAt: number;
}

export async function listInstalledToolPlugins(): Promise<InstalledToolPlugin[]> {
  const records = await request<InstalledToolPlugin[]>((await readyStore()).getAll());
  return records
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((record) => structuredClone(record));
}

export async function installToolPluginManifest(
  manifest: ToolPluginManifest,
  now = Date.now(),
): Promise<InstalledToolPlugin> {
  return installToolPlugin(manifest, undefined, now);
}

export async function installToolPlugin(
  manifest: ToolPluginManifest,
  artifact?: ToolPluginArtifact,
  now = Date.now(),
): Promise<InstalledToolPlugin> {
  if (artifact && (artifact.pluginId !== manifest.id || artifact.contentHash !== manifest.contentHash)) {
    throw new Error("TOOL_PLUGIN_ARTIFACT_IDENTITY_MISMATCH");
  }
  const previous = await getInstalledToolPlugin(manifest.id);
  if (previous?.manifest.version === manifest.version && previous.manifest.contentHash !== manifest.contentHash) {
    throw new Error("TOOL_PLUGIN_VERSION_HASH_CONFLICT");
  }
  const history = previous && previous.manifest.contentHash !== manifest.contentHash
    ? [
        { manifest: previous.manifest, archivedAt: now },
        ...previous.history.filter((item) => item.manifest.contentHash !== previous.manifest.contentHash),
      ].slice(0, 8)
    : previous?.history ?? [];
  const record: InstalledToolPlugin = {
    id: manifest.id,
    manifest: structuredClone(manifest),
    installedAt: previous?.installedAt ?? now,
    updatedAt: now,
    enabled: previous?.manifest.contentHash === manifest.contentHash ? previous.enabled : false,
    grantedPermissions: previous?.manifest.contentHash === manifest.contentHash
      ? previous.grantedPermissions.filter((permission) => hasPermission(manifest, permission))
      : [],
    history,
  };
  const db = await openToolPluginDb();
  const transaction = db.transaction([PLUGINS_STORE, ARTIFACTS_STORE], "readwrite");
  transaction.objectStore(PLUGINS_STORE).put(record);
  if (artifact) transaction.objectStore(ARTIFACTS_STORE).put(structuredClone(artifact));
  await transactionDone(transaction);
  await pruneToolPluginArtifacts(record);
  return structuredClone(record);
}

export async function setToolPluginPermissions(
  pluginId: string,
  grantedPermissions: readonly ToolPluginPermission[],
  now = Date.now(),
): Promise<InstalledToolPlugin> {
  return updatePlugin(pluginId, now, (record) => {
    const allowed = new Set(record.manifest.permissions.map((permission) => permission.id));
    const grants = [...new Set(grantedPermissions)].filter((permission) => allowed.has(permission));
    const required = record.manifest.permissions
      .filter((permission) => !permission.optional)
      .map((permission) => permission.id);
    return {
      ...record,
      enabled: record.enabled && required.every((permission) => grants.includes(permission)),
      grantedPermissions: grants,
    };
  });
}

export async function setToolPluginEnabled(
  pluginId: string,
  enabled: boolean,
  now = Date.now(),
): Promise<InstalledToolPlugin> {
  const current = await getInstalledToolPlugin(pluginId);
  if (!current) throw new Error("TOOL_PLUGIN_NOT_FOUND");
  if (enabled && current.manifest.manifestVersion === 2) {
    if (current.manifest.tools.some((tool) => tool.handler?.kind === "worker")) {
      const artifact = await getToolPluginArtifact(current.manifest.contentHash);
      if (!artifact?.entryCode) throw new Error("TOOL_PLUGIN_ARTIFACT_MISSING");
    }
    const credentialStatus = await listToolPluginCredentialStatus(pluginId);
    const configured = new Set(credentialStatus.filter((item) => item.configured).map((item) => item.id));
    if (current.manifest.credentials?.some((credential) => credential.required && !configured.has(credential.id))) {
      throw new Error("TOOL_PLUGIN_REQUIRED_CREDENTIAL_MISSING");
    }
  }
  return updatePlugin(pluginId, now, (record) => {
    if (enabled) {
      const granted = new Set(record.grantedPermissions);
      const missing = record.manifest.permissions.some(
        (permission) => !permission.optional && !granted.has(permission.id),
      );
      if (missing) throw new Error("TOOL_PLUGIN_REQUIRED_PERMISSION_MISSING");
    }
    return { ...record, enabled };
  });
}

export async function rollbackToolPlugin(
  pluginId: string,
  contentHash: string,
  now = Date.now(),
): Promise<InstalledToolPlugin> {
  const updated = await updatePlugin(pluginId, now, (record) => {
    const target = record.history.find((item) => item.manifest.contentHash === contentHash);
    if (!target) throw new Error("TOOL_PLUGIN_ROLLBACK_VERSION_NOT_FOUND");
    const nextHistory = [
      { manifest: record.manifest, archivedAt: now },
      ...record.history.filter((item) => item.manifest.contentHash !== contentHash),
    ].slice(0, 8);
    return {
      ...record,
      manifest: target.manifest,
      enabled: false,
      grantedPermissions: [],
      history: nextHistory,
    };
  });
  await pruneToolPluginArtifacts(updated);
  return updated;
}

export async function uninstallToolPlugin(pluginId: string): Promise<void> {
  const db = await openToolPluginDb();
  const artifacts = await request<ToolPluginArtifact[]>(
    db.transaction(ARTIFACTS_STORE, "readonly").objectStore(ARTIFACTS_STORE).getAll(),
  );
  const credentials = await request<StoredCredential[]>(
    db.transaction(CREDENTIALS_STORE, "readonly").objectStore(CREDENTIALS_STORE).getAll(),
  );
  const transaction = db.transaction([PLUGINS_STORE, ARTIFACTS_STORE, CREDENTIALS_STORE], "readwrite");
  transaction.objectStore(PLUGINS_STORE).delete(pluginId);
  for (const artifact of artifacts) {
    if (artifact.pluginId === pluginId) transaction.objectStore(ARTIFACTS_STORE).delete(artifact.contentHash);
  }
  for (const credential of credentials) {
    if (credential.pluginId === pluginId) transaction.objectStore(CREDENTIALS_STORE).delete(credential.key);
  }
  await transactionDone(transaction);
}

export async function getToolPluginArtifact(contentHash: string): Promise<ToolPluginArtifact | undefined> {
  const result = await request<ToolPluginArtifact | undefined>(
    (await readyStore(ARTIFACTS_STORE)).get(contentHash),
  );
  return result ? structuredClone(result) : undefined;
}

export async function setToolPluginCredential(
  pluginId: string,
  credentialId: string,
  value: string,
  now = Date.now(),
): Promise<void> {
  const plugin = await getInstalledToolPlugin(pluginId);
  const declaration = plugin?.manifest.credentials?.find((credential) => credential.id === credentialId);
  if (!plugin || !declaration) throw new Error("TOOL_PLUGIN_CREDENTIAL_NOT_DECLARED");
  if (!value.trim()) throw new Error("TOOL_PLUGIN_CREDENTIAL_EMPTY");
  const encryptedValue = await encryptValue(value, await getCredentialCryptoKey());
  const store = await readyStore(CREDENTIALS_STORE, "readwrite");
  store.put({
    key: credentialKey(pluginId, credentialId),
    pluginId,
    credentialId,
    encryptedValue,
    updatedAt: now,
  } satisfies StoredCredential);
  await transactionDone(store.transaction);
}

export async function deleteToolPluginCredential(pluginId: string, credentialId: string): Promise<void> {
  const store = await readyStore(CREDENTIALS_STORE, "readwrite");
  store.delete(credentialKey(pluginId, credentialId));
  await transactionDone(store.transaction);
  const plugin = await getInstalledToolPlugin(pluginId);
  if (plugin?.manifest.credentials?.some((credential) => credential.id === credentialId && credential.required)) {
    await setToolPluginEnabled(pluginId, false);
  }
}

export async function resolveToolPluginCredential(pluginId: string, credentialId: string): Promise<string> {
  const stored = await request<StoredCredential | undefined>(
    (await readyStore(CREDENTIALS_STORE)).get(credentialKey(pluginId, credentialId)),
  );
  if (!stored) throw new Error("TOOL_PLUGIN_CREDENTIAL_MISSING");
  const value = await decryptValue(stored.encryptedValue, await getCredentialCryptoKey());
  if (!value) throw new Error("TOOL_PLUGIN_CREDENTIAL_DECRYPT_FAILED");
  return value;
}

export async function listToolPluginCredentialStatus(pluginId: string): Promise<ToolPluginCredentialStatus[]> {
  const plugin = await getInstalledToolPlugin(pluginId);
  if (!plugin) throw new Error("TOOL_PLUGIN_NOT_FOUND");
  const stored = await request<StoredCredential[]>((await readyStore(CREDENTIALS_STORE)).getAll());
  const byId = new Map(stored.filter((item) => item.pluginId === pluginId).map((item) => [item.credentialId, item]));
  return (plugin.manifest.credentials ?? []).map((declaration) => {
    const item = byId.get(declaration.id);
    return { id: declaration.id, configured: !!item, ...(item ? { updatedAt: item.updatedAt } : {}) };
  });
}

async function updatePlugin(
  pluginId: string,
  now: number,
  update: (record: InstalledToolPlugin) => InstalledToolPlugin,
): Promise<InstalledToolPlugin> {
  const previous = await getInstalledToolPlugin(pluginId);
  if (!previous) throw new Error("TOOL_PLUGIN_NOT_FOUND");
  const next = { ...update(previous), updatedAt: now };
  await putInstalledToolPlugin(next);
  return structuredClone(next);
}

function hasPermission(manifest: ToolPluginManifest, permission: ToolPluginPermission): boolean {
  return manifest.permissions.some((item) => item.id === permission);
}

export async function getInstalledToolPlugin(pluginId: string): Promise<InstalledToolPlugin | undefined> {
  return request<InstalledToolPlugin | undefined>((await readyStore()).get(pluginId));
}

async function putInstalledToolPlugin(record: InstalledToolPlugin): Promise<void> {
  const store = await readyStore(PLUGINS_STORE, "readwrite");
  store.put(record);
  await transactionDone(store.transaction);
}

async function openToolPluginDb(): Promise<IDBDatabase> {
  if (openedDb) return openedDb;
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const opening = indexedDB.open(DB_NAME, DB_VERSION);
      opening.onupgradeneeded = () => {
        if (!opening.result.objectStoreNames.contains(PLUGINS_STORE)) {
          opening.result.createObjectStore(PLUGINS_STORE, { keyPath: "id" });
        }
        if (!opening.result.objectStoreNames.contains(ARTIFACTS_STORE)) {
          opening.result.createObjectStore(ARTIFACTS_STORE, { keyPath: "contentHash" });
        }
        if (!opening.result.objectStoreNames.contains(CREDENTIALS_STORE)) {
          opening.result.createObjectStore(CREDENTIALS_STORE, { keyPath: "key" });
        }
        if (!opening.result.objectStoreNames.contains(META_STORE)) {
          opening.result.createObjectStore(META_STORE);
        }
      };
      opening.onsuccess = () => {
        openedDb = opening.result;
        openedDb.onversionchange = () => openedDb?.close();
        resolve(openedDb);
      };
      opening.onerror = () => reject(opening.error ?? new Error("TOOL_PLUGIN_DB_OPEN_FAILED"));
    });
  }
  return dbPromise;
}

async function readyStore(
  storeName: string = PLUGINS_STORE,
  mode: IDBTransactionMode = "readonly",
): Promise<IDBObjectStore> {
  return (await openToolPluginDb()).transaction(storeName, mode).objectStore(storeName);
}

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error ?? new Error("TOOL_PLUGIN_DB_REQUEST_FAILED"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("TOOL_PLUGIN_DB_TRANSACTION_FAILED"));
    transaction.onabort = () => reject(transaction.error ?? new Error("TOOL_PLUGIN_DB_TRANSACTION_ABORTED"));
  });
}

export const __toolPluginStorageTest = {
  async reset(): Promise<void> {
    openedDb?.close();
    openedDb = null;
    dbPromise = null;
    credentialKeyPromise = null;
    await new Promise<void>((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase(DB_NAME);
      deletion.onsuccess = () => resolve();
      deletion.onerror = () => reject(deletion.error ?? new Error("TOOL_PLUGIN_DB_DELETE_FAILED"));
      deletion.onblocked = () => reject(new Error("TOOL_PLUGIN_DB_DELETE_BLOCKED"));
    });
    await openToolPluginDb();
  },
};

async function pruneToolPluginArtifacts(plugin: InstalledToolPlugin): Promise<void> {
  const keep = new Set([
    plugin.manifest.contentHash,
    ...plugin.history.map((item) => item.manifest.contentHash),
  ]);
  const store = await readyStore(ARTIFACTS_STORE, "readwrite");
  const artifacts = await request<ToolPluginArtifact[]>(store.getAll());
  for (const artifact of artifacts) {
    if (artifact.pluginId === plugin.id && !keep.has(artifact.contentHash)) store.delete(artifact.contentHash);
  }
  await transactionDone(store.transaction);
}

function credentialKey(pluginId: string, credentialId: string): string {
  return `${pluginId}:${credentialId}`;
}

async function getCredentialCryptoKey(): Promise<CryptoKey> {
  if (credentialKeyPromise) return credentialKeyPromise;
  credentialKeyPromise = (async () => {
    const stored = await request<CryptoKey | undefined>((await readyStore(META_STORE)).get(CREDENTIAL_KEY_ID));
    if (stored) return stored;
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const store = await readyStore(META_STORE, "readwrite");
    store.put(key, CREDENTIAL_KEY_ID);
    await transactionDone(store.transaction);
    return key;
  })().catch((error: unknown) => {
    credentialKeyPromise = null;
    throw error;
  });
  return credentialKeyPromise;
}
