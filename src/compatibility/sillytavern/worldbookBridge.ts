import type { CharacterCard, CustomWorldbook, LorebookEntry } from "../../types";
import { getRuntimeKernel } from "../../kernel/runtimeKernel";
import {
  getBridgeParams,
  tavernHelperEventEmitter,
  type TavernHelperBridgeParams,
} from "../../utils/tavernHelper/bridgeCore";
import {
  asRecord,
  fromTavernHelperWorldbookEntry,
  readFiniteNumber,
  readTrimmedString,
  resolveEntryUid,
  stripForbiddenKeys,
  toTavernHelperLorebookEntry,
  toTavernHelperWorldbookEntry,
  type TavernHelperWorldbookEntry,
} from "./worldbookEntryCodec";

export type {
  TavernHelperSelectiveLogic,
  TavernHelperWorldbookEntry,
  TavernHelperWorldbookPositionType,
  TavernHelperWorldbookRole,
} from "./worldbookEntryCodec";
export {
  fromTavernHelperWorldbookEntry,
  toTavernHelperLorebookEntry,
  toTavernHelperWorldbookEntry,
} from "./worldbookEntryCodec";

export const GLOBAL_WORLDBOOK_NAME = "global";
const GLOBAL_WORLDBOOK_ALIASES = new Set(["global", "__global__", "全局世界书"]);

export interface TavernHelperCharWorldbooks {
  primary: string | null;
  additional: string[];
}

export interface TavernHelperLorebookStaticSettings {
  scan_depth: number;
  context_percent: number;
  budget_cap: number;
  min_activations: number;
  max_depth: number;
  max_recursion_steps: number;
  include_names: boolean;
  recursive: boolean;
  case_sensitive: boolean;
  match_whole_words: boolean;
  use_group_scoring: boolean;
  overflow_alert: boolean;
}

export interface TavernHelperLorebookSettings extends TavernHelperLorebookStaticSettings {
  selected_global_lorebooks: string[];
  [key: string]: unknown;
}

type ResolvedWorldbookTarget =
  | { kind: "custom"; id: string; name: string; worldbook: CustomWorldbook; entries: LorebookEntry[] }
  | { kind: "character"; name: string; character: CharacterCard; entries: LorebookEntry[] }
  | { kind: "global"; name: string; entries: LorebookEntry[] };

const DEFAULT_LOREBOOK_SETTINGS: TavernHelperLorebookStaticSettings = {
  scan_depth: 2,
  context_percent: 25,
  budget_cap: 0,
  min_activations: 0,
  max_depth: 0,
  max_recursion_steps: 0,
  include_names: false,
  recursive: true,
  case_sensitive: false,
  match_whole_words: false,
  use_group_scoring: false,
  overflow_alert: false,
};

let runtimeLorebookSettings: TavernHelperLorebookStaticSettings & Record<string, unknown> = {
  ...DEFAULT_LOREBOOK_SETTINGS,
};

export function resolveCharacterPrimaryWorldbookName(
  character: CharacterCard | null | undefined,
): string | null {
  if (!character) return null;
  const extWorld = readTrimmedString(asRecord(character.extensions).world);
  if (extWorld) return extWorld;
  const metaBook = asRecord(asRecord(character.sourceMetadata).character_book);
  const metaBookName = readTrimmedString(metaBook.name);
  if (metaBookName) return metaBookName;
  if ((character.lorebookEntries?.length ?? 0) > 0) {
    return readTrimmedString(character.name) ?? "character";
  }
  return null;
}

function readCharacterAdditionalWorldbooks(
  character: CharacterCard | null | undefined,
  primary: string | null,
): string[] {
  if (!character) return [];
  const ext = asRecord(character.extensions);
  const candidates = ext.extra_world_books ?? ext.additional_worldbooks ?? ext.world_additional;
  if (!Array.isArray(candidates)) return [];
  const seen = new Set<string>(primary ? [primary] : []);
  const result: string[] = [];
  for (const item of candidates) {
    const name = readTrimmedString(item);
    if (name && !seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}

function resolveCharacterTarget(
  params: TavernHelperBridgeParams | null,
  target?: unknown,
): CharacterCard | null {
  if (!params) return null;
  if (target === undefined || target === null || target === "current") {
    return params.activeCharacter;
  }
  const targetName = readTrimmedString(target);
  if (!targetName) return params.activeCharacter;
  if (params.activeCharacter && (params.activeCharacter.id === targetName || params.activeCharacter.name === targetName)) {
    return params.activeCharacter;
  }
  return (params.characters ?? []).find(
    (char) => char.id === targetName || char.name === targetName,
  ) ?? null;
}

function findMatchingCharacterForBook(
  params: TavernHelperBridgeParams,
  worldbookName: string,
): CharacterCard | null {
  const candidates: CharacterCard[] = [];
  if (params.activeCharacter) candidates.push(params.activeCharacter);
  for (const char of params.characters ?? []) {
    if (char.id !== params.activeCharacter?.id) candidates.push(char);
  }
  for (const char of candidates) {
    const primaryName = resolveCharacterPrimaryWorldbookName(char);
    if (primaryName === worldbookName || char.name === worldbookName) {
      return char;
    }
  }
  return null;
}

function resolveWorldbookTarget(
  params: TavernHelperBridgeParams | null,
  worldbookName: unknown,
): ResolvedWorldbookTarget | null {
  if (!params) return null;
  const name = readTrimmedString(worldbookName);
  if (!name) return null;

  const customWorldbooks = params.customWorldbooks ?? {};
  for (const [id, wb] of Object.entries(customWorldbooks)) {
    if (wb && (wb.name === name || wb.id === name || id === name)) {
      return {
        kind: "custom",
        id,
        name: wb.name,
        worldbook: wb,
        entries: wb.entries ?? [],
      };
    }
  }

  const matchedChar = findMatchingCharacterForBook(params, name);
  if (matchedChar) {
    return {
      kind: "character",
      name: resolveCharacterPrimaryWorldbookName(matchedChar) ?? matchedChar.name,
      character: matchedChar,
      entries: matchedChar.lorebookEntries ?? [],
    };
  }

  if (GLOBAL_WORLDBOOK_ALIASES.has(name.toLowerCase())) {
    return {
      kind: "global",
      name: GLOBAL_WORLDBOOK_NAME,
      entries: params.globalLorebook ?? [],
    };
  }

  return null;
}

async function persistResolvedWorldbook(
  params: TavernHelperBridgeParams,
  target: ResolvedWorldbookTarget,
  nextEntries: LorebookEntry[],
): Promise<void> {
  if (target.kind === "custom") {
    const nextBook: CustomWorldbook = { ...target.worldbook, entries: nextEntries };
    const nextMap = { ...(params.customWorldbooks ?? {}), [target.id]: nextBook };
    params.customWorldbooks = nextMap;
    if (params.updateCustomWorldbooks) {
      await params.updateCustomWorldbooks((prev) => ({
        ...prev,
        [target.id]: { ...(prev[target.id] ?? target.worldbook), entries: nextEntries },
      }));
    }
  } else if (target.kind === "character") {
    const updatedChar: CharacterCard = { ...target.character, lorebookEntries: nextEntries };
    if (params.activeCharacter?.id === updatedChar.id) {
      params.activeCharacter = updatedChar;
    }
    if (Array.isArray(params.characters)) {
      params.characters = params.characters.map((c) => (c.id === updatedChar.id ? updatedChar : c));
    }
    params.setCharacters((prev) => prev.map((c) => (c.id === updatedChar.id ? updatedChar : c)));
    await params.saveCharacter(updatedChar);
  } else {
    params.globalLorebook = nextEntries;
    if (params.saveGlobalLorebook) {
      await params.saveGlobalLorebook(nextEntries);
    }
  }

  if (getRuntimeKernel()) {
    const serialized = nextEntries.map((entry, index) => toTavernHelperWorldbookEntry(entry, index));
    tavernHelperEventEmitter.emit("worldinfo_updated", target.name, serialized);
  }
}

function buildNextEntries(
  existingEntries: readonly LorebookEntry[],
  incoming: unknown[],
): LorebookEntry[] {
  const existingByUid = new Map<number, LorebookEntry>();
  const existingById = new Map<string, LorebookEntry>();
  existingEntries.forEach((entry, index) => {
    existingByUid.set(resolveEntryUid(entry, index), entry);
    existingById.set(entry.id, entry);
  });

  return incoming.map((item, index) => {
    const record = asRecord(item);
    const id = readTrimmedString(record.id);
    const uid = readFiniteNumber(record.uid);
    const matched = (id ? existingById.get(id) : undefined)
      ?? (uid !== undefined ? existingByUid.get(uid) : undefined);
    return fromTavernHelperWorldbookEntry(item, matched, index);
  });
}

export function getCharWorldbookNames(target?: unknown): TavernHelperCharWorldbooks {
  const params = getBridgeParams();
  const character = resolveCharacterTarget(params, target);
  const primary = resolveCharacterPrimaryWorldbookName(character);
  const additional = readCharacterAdditionalWorldbooks(character, primary);
  return { primary, additional };
}

export function getCharLorebooks(target?: unknown): Promise<TavernHelperCharWorldbooks> {
  return Promise.resolve(getCharWorldbookNames(target));
}

export function getCurrentCharPrimaryLorebook(): string | null {
  return getCharWorldbookNames("current").primary;
}

export function getGlobalWorldbookNames(): string[] {
  const params = getBridgeParams();
  if (!params) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const wb of Object.values(params.customWorldbooks ?? {})) {
    if (wb?.enabled && wb.name && !seen.has(wb.name)) {
      seen.add(wb.name);
      names.push(wb.name);
    }
  }
  if ((params.globalLorebook?.length ?? 0) > 0 && !seen.has(GLOBAL_WORLDBOOK_NAME)) {
    names.push(GLOBAL_WORLDBOOK_NAME);
  }
  return names;
}

export function getWorldbookNames(): string[] {
  const params = getBridgeParams();
  if (!params) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const wb of Object.values(params.customWorldbooks ?? {})) {
    if (wb?.name && !seen.has(wb.name)) {
      seen.add(wb.name);
      names.push(wb.name);
    }
  }
  const activePrimary = resolveCharacterPrimaryWorldbookName(params.activeCharacter);
  if (activePrimary && !seen.has(activePrimary)) {
    seen.add(activePrimary);
    names.push(activePrimary);
  }
  if ((params.globalLorebook?.length ?? 0) > 0 && !seen.has(GLOBAL_WORLDBOOK_NAME)) {
    names.push(GLOBAL_WORLDBOOK_NAME);
  }
  return names;
}

export async function getWorldbook(worldbookName: unknown): Promise<TavernHelperWorldbookEntry[]> {
  const params = getBridgeParams();
  const resolved = resolveWorldbookTarget(params, worldbookName);
  if (!resolved) {
    throw new Error(`WORLD_BOOK_NOT_FOUND:${String(worldbookName ?? "")}`);
  }
  return resolved.entries.map((entry, index) => toTavernHelperWorldbookEntry(entry, index));
}

export async function replaceWorldbook(
  worldbookName: unknown,
  entries: unknown,
  _options?: unknown,
): Promise<TavernHelperWorldbookEntry[]> {
  const params = getBridgeParams();
  const resolved = resolveWorldbookTarget(params, worldbookName);
  if (!params || !resolved) {
    throw new Error(`WORLD_BOOK_NOT_FOUND:${String(worldbookName ?? "")}`);
  }
  if (!Array.isArray(entries)) {
    throw new Error("WORLD_BOOK_ENTRIES_INVALID");
  }
  const nextEntries = buildNextEntries(resolved.entries, entries);
  await persistResolvedWorldbook(params, resolved, nextEntries);
  return nextEntries.map((entry, index) => toTavernHelperWorldbookEntry(entry, index));
}

export async function updateWorldbookWith(
  worldbookName: unknown,
  updater: unknown,
  options?: unknown,
): Promise<TavernHelperWorldbookEntry[]> {
  if (typeof updater !== "function") {
    throw new Error("WORLD_BOOK_UPDATER_INVALID");
  }
  const current = await getWorldbook(worldbookName);
  const result = await (updater as (entries: TavernHelperWorldbookEntry[]) => unknown)(current);
  const next = Array.isArray(result) ? result : current;
  return replaceWorldbook(worldbookName, next, options);
}

export async function createWorldbook(
  worldbookName: unknown,
  entries: unknown = [],
): Promise<boolean> {
  const params = getBridgeParams();
  const name = readTrimmedString(worldbookName);
  if (!params || !name) return false;
  if (resolveWorldbookTarget(params, name)) return false;

  const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const rawList = Array.isArray(entries) ? entries : [];
  const mappedEntries = buildNextEntries([], rawList);
  const created: CustomWorldbook = {
    id,
    name,
    entries: mappedEntries,
    enabled: true,
  };
  params.customWorldbooks = { ...(params.customWorldbooks ?? {}), [id]: created };
  if (params.updateCustomWorldbooks) {
    await params.updateCustomWorldbooks((prev) => ({ ...prev, [id]: created }));
  }
  return true;
}

export async function createOrReplaceWorldbook(
  worldbookName: unknown,
  entries: unknown,
): Promise<TavernHelperWorldbookEntry[]> {
  const params = getBridgeParams();
  const existing = resolveWorldbookTarget(params, worldbookName);
  if (!existing) {
    await createWorldbook(worldbookName, entries);
    return getWorldbook(worldbookName);
  }
  return replaceWorldbook(worldbookName, entries);
}

export async function deleteWorldbook(worldbookName: unknown): Promise<boolean> {
  const params = getBridgeParams();
  const name = readTrimmedString(worldbookName);
  if (!params || !name) return false;
  const target = resolveWorldbookTarget(params, name);
  if (!target || target.kind !== "custom") return false;

  const next = { ...(params.customWorldbooks ?? {}) };
  delete next[target.id];
  params.customWorldbooks = next;
  if (params.updateCustomWorldbooks) {
    await params.updateCustomWorldbooks((prev) => {
      const updated = { ...prev };
      delete updated[target.id];
      return updated;
    });
  }
  return true;
}

export async function getLorebookEntries(worldbookName: unknown): Promise<Record<string, unknown>[]> {
  const params = getBridgeParams();
  const resolved = resolveWorldbookTarget(params, worldbookName);
  if (!resolved) return [];
  return resolved.entries.map((entry, index) => toTavernHelperLorebookEntry(entry, index));
}

export async function setLorebookEntries(
  worldbookName: unknown,
  updates: unknown,
): Promise<void> {
  const params = getBridgeParams();
  const resolved = resolveWorldbookTarget(params, worldbookName);
  if (!params || !resolved || !Array.isArray(updates)) return;

  const byUid = new Map<number, Record<string, unknown>>();
  for (const item of updates) {
    const rec = asRecord(item);
    const uid = readFiniteNumber(rec.uid);
    if (uid !== undefined) byUid.set(uid, rec);
  }

  const nextEntries = resolved.entries.map((entry, index) => {
    const uid = resolveEntryUid(entry, index);
    const patch = byUid.get(uid);
    if (!patch) return entry;
    return fromTavernHelperWorldbookEntry(patch, entry, index);
  });
  await persistResolvedWorldbook(params, resolved, nextEntries);
}

export async function createLorebookEntries(
  worldbookName: unknown,
  entries: unknown,
): Promise<Record<string, unknown>[]> {
  const params = getBridgeParams();
  const resolved = resolveWorldbookTarget(params, worldbookName);
  if (!params || !resolved || !Array.isArray(entries)) return [];

  const maxUid = resolved.entries.reduce(
    (max, entry, index) => Math.max(max, resolveEntryUid(entry, index)),
    -1,
  );
  const created = entries.map((item, offset) => {
    const rec = { ...asRecord(item), uid: maxUid + 1 + offset };
    return fromTavernHelperWorldbookEntry(rec, undefined, resolved.entries.length + offset);
  });
  const nextEntries = [...resolved.entries, ...created];
  await persistResolvedWorldbook(params, resolved, nextEntries);
  return created.map((entry, offset) => toTavernHelperLorebookEntry(entry, resolved.entries.length + offset));
}

export async function deleteLorebookEntries(
  worldbookName: unknown,
  uids: unknown,
): Promise<void> {
  const params = getBridgeParams();
  const resolved = resolveWorldbookTarget(params, worldbookName);
  if (!params || !resolved || !Array.isArray(uids)) return;
  const uidSet = new Set(uids.map((u) => readFiniteNumber(u)).filter((u): u is number => u !== undefined));
  const nextEntries = resolved.entries.filter((entry, index) => !uidSet.has(resolveEntryUid(entry, index)));
  await persistResolvedWorldbook(params, resolved, nextEntries);
}

export function getLorebookSettings(): TavernHelperLorebookSettings {
  return {
    ...DEFAULT_LOREBOOK_SETTINGS,
    ...runtimeLorebookSettings,
    selected_global_lorebooks: getGlobalWorldbookNames(),
  };
}

export function setLorebookSettings(patch: unknown): void {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return;
  const cleanPatch = stripForbiddenKeys(patch) as Partial<TavernHelperLorebookStaticSettings> & Record<string, unknown>;
  runtimeLorebookSettings = { ...runtimeLorebookSettings, ...cleanPatch };

  if (Array.isArray(cleanPatch.selected_global_lorebooks)) {
    const selected = new Set(
      cleanPatch.selected_global_lorebooks.filter((name): name is string => typeof name === "string"),
    );
    const params = getBridgeParams();
    if (params?.customWorldbooks) {
      const next: Record<string, CustomWorldbook> = {};
      let changed = false;
      for (const [id, wb] of Object.entries(params.customWorldbooks)) {
        const shouldEnable = selected.has(wb.name);
        if (wb.enabled !== shouldEnable) changed = true;
        next[id] = { ...wb, enabled: shouldEnable };
      }
      if (changed) {
        params.customWorldbooks = next;
        if (params.updateCustomWorldbooks) {
          void params.updateCustomWorldbooks((prev) => {
            const updated: Record<string, CustomWorldbook> = {};
            for (const [id, wb] of Object.entries(prev)) {
              updated[id] = { ...wb, enabled: selected.has(wb.name) };
            }
            return updated;
          });
        }
      }
    }
  }
}

export function createWorldbookBindMethods() {
  return {
    _getCharLorebooks: getCharLorebooks,
    _getCharWorldbookNames: getCharWorldbookNames,
    _getCurrentCharPrimaryLorebook: getCurrentCharPrimaryLorebook,
    _getLorebookEntries: getLorebookEntries,
    _setLorebookEntries: setLorebookEntries,
    _createLorebookEntries: createLorebookEntries,
    _deleteLorebookEntries: deleteLorebookEntries,
    _getLorebookSettings: getLorebookSettings,
    _setLorebookSettings: setLorebookSettings,
    _getWorldbook: getWorldbook,
    _replaceWorldbook: replaceWorldbook,
    _updateWorldbookWith: updateWorldbookWith,
    _getWorldbookNames: getWorldbookNames,
    _getGlobalWorldbookNames: getGlobalWorldbookNames,
    _createWorldbook: createWorldbook,
    _createOrReplaceWorldbook: createOrReplaceWorldbook,
    _deleteWorldbook: deleteWorldbook,
  };
}

export function createWorldbookPublicMethods() {
  return {
    getCharLorebooks,
    getCharWorldbookNames,
    getCurrentCharPrimaryLorebook,
    getLorebookEntries,
    setLorebookEntries,
    createLorebookEntries,
    deleteLorebookEntries,
    getLorebookSettings,
    setLorebookSettings,
    getWorldbook,
    replaceWorldbook,
    updateWorldbookWith,
    getWorldbookNames,
    getGlobalWorldbookNames,
    createWorldbook,
    createOrReplaceWorldbook,
    deleteWorldbook,
  };
}
