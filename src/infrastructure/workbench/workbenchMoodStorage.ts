const STORAGE_KEY = "mobile_tavern_workbench_moods_v1";

/** 物理存储边界只负责 JSON 往返；业务结构由应用层校验。 */
export function readWorkbenchMoodStorage(): unknown {
  try {
    if (typeof localStorage === "undefined") return undefined;
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return undefined;
  }
}

export function writeWorkbenchMoodStorage(value: unknown): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
