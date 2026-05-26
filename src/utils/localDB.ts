import { CharacterCard, ChatSession, UserSettings, LorebookEntry } from "../types";

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

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveStoredSettings(settings: UserSettings): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("settings", "readwrite");
    const store = transaction.objectStore("settings");
    const request = store.put(settings, "user_settings");

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

export async function saveGlobalLorebook(entries: LorebookEntry[]): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("settings", "readwrite");
    const store = transaction.objectStore("settings");
    const request = store.put(entries, "global_lorebook");

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
