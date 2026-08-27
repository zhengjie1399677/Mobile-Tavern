export type MobileBackHandler = () => boolean;

interface RegisteredBackHandler {
  id: number;
  priority: number;
  handler: MobileBackHandler;
}

interface MobileBackRegistry {
  nextId: number;
  handlers: RegisteredBackHandler[];
}

const REGISTRY_KEY = "__MOBILE_TAVERN_BACK_REGISTRY_V1__" as const;

type MobileBackGlobal = typeof globalThis & {
  [REGISTRY_KEY]?: MobileBackRegistry;
};

type MobileBackWindow = Window & {
  __mobileTavernHandleBack?: () => boolean;
};

const mobileBackGlobal = globalThis as MobileBackGlobal;
const registry = mobileBackGlobal[REGISTRY_KEY] ?? { nextId: 1, handlers: [] };
mobileBackGlobal[REGISTRY_KEY] = registry;

export function dispatchMobileBack(): boolean {
  const candidates = [...registry.handlers].sort(
    (left, right) => right.priority - left.priority || right.id - left.id,
  );
  for (const candidate of candidates) {
    if (candidate.handler()) return true;
  }
  return false;
}

export function installMobileBackBridge(): void {
  if (typeof window === "undefined") return;
  (window as MobileBackWindow).__mobileTavernHandleBack = dispatchMobileBack;
}

export function registerMobileBackHandler(
  handler: MobileBackHandler,
  priority = 0,
): () => void {
  installMobileBackBridge();
  const entry = { id: registry.nextId++, priority, handler };
  registry.handlers.push(entry);
  return () => {
    const index = registry.handlers.findIndex((candidate) => candidate.id === entry.id);
    if (index >= 0) registry.handlers.splice(index, 1);
  };
}

export function resetMobileBackHandlersForTest(): void {
  registry.handlers.splice(0, registry.handlers.length);
  registry.nextId = 1;
}
