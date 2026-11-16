import type { LorebookEntry } from "../../types";
import { normalizeSelectiveLogic } from "../../utils/cardParser";

export type TavernHelperWorldbookPositionType =
  | "before_character_definition"
  | "after_character_definition"
  | "before_example_messages"
  | "after_example_messages"
  | "before_author_note"
  | "after_author_note"
  | "at_depth";

export type TavernHelperWorldbookRole = "system" | "user" | "assistant";
export type TavernHelperSelectiveLogic = "and_any" | "and_all" | "not_all" | "not_any";

export interface TavernHelperWorldbookEntry {
  uid: number;
  name: string;
  enabled: boolean;
  strategy: {
    type: "constant" | "selective" | "vectorized";
    keys: string[];
    keys_secondary: {
      logic: TavernHelperSelectiveLogic;
      keys: string[];
    };
    scan_depth: number | "same_as_global";
  };
  position: {
    type: TavernHelperWorldbookPositionType;
    role: TavernHelperWorldbookRole;
    depth: number;
    order: number;
  };
  content: string;
  probability: number;
  recursion: {
    prevent_incoming: boolean;
    prevent_outgoing: boolean;
    delay_until: number | null;
  };
  effect: {
    sticky: number | null;
    cooldown: number | null;
    delay: number | null;
  };
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function readTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function readFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return undefined;
}

export function stripForbiddenKeys(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripForbiddenKeys(item, depth + 1));
  }
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    output[key] = stripForbiddenKeys((value as Record<string, unknown>)[key], depth + 1);
  }
  return output;
}

function normalizeKeyArray(raw: unknown): { keys: string[]; hasRegExp: boolean } {
  if (!Array.isArray(raw)) {
    if (typeof raw === "string") {
      return {
        keys: raw.split(",").map((item) => item.trim()).filter(Boolean),
        hasRegExp: false,
      };
    }
    return { keys: [], hasRegExp: false };
  }
  const keys: string[] = [];
  let hasRegExp = false;
  for (const item of raw) {
    if (item instanceof RegExp) {
      keys.push(item.toString());
      hasRegExp = true;
    } else if (typeof item === "string") {
      const trimmed = item.trim();
      if (trimmed) keys.push(trimmed);
    }
  }
  return { keys, hasRegExp };
}

function sourceField(entry: LorebookEntry, key: string): unknown {
  const meta = asRecord(entry.sourceMetadata);
  if (meta[key] !== undefined) return meta[key];
  return asRecord(meta.extensions)[key];
}

export function resolveEntryUid(entry: LorebookEntry, index: number): number {
  const fromSource = readFiniteNumber(sourceField(entry, "uid"));
  if (fromSource !== undefined && Number.isInteger(fromSource) && fromSource >= 0) {
    return fromSource;
  }
  return index;
}

function toWorldbookRole(entry: LorebookEntry): TavernHelperWorldbookRole {
  const raw = sourceField(entry, "role");
  if (raw === "user" || raw === "assistant" || raw === "system") return raw;
  const num = readFiniteNumber(raw);
  if (num === 1) return "user";
  if (num === 2) return "assistant";
  return "system";
}

function toStRoleIndex(role: unknown): number {
  if (role === "user" || role === 1) return 1;
  if (role === "assistant" || role === 2) return 2;
  return 0;
}

function toWorldbookPositionType(entry: LorebookEntry): TavernHelperWorldbookPositionType {
  const rawPos = sourceField(entry, "position");
  const numPos = readFiniteNumber(rawPos);
  if (numPos !== undefined) {
    switch (numPos) {
      case 0: return "before_character_definition";
      case 1: return "after_character_definition";
      case 2: return "before_author_note";
      case 3: return "after_author_note";
      case 4: return "at_depth";
      case 5: return "before_example_messages";
      case 6: return "after_example_messages";
      default: return "after_character_definition";
    }
  }
  switch (entry.position) {
    case "top":
    case "before_char_def":
      return "before_character_definition";
    case "before_last_mes":
      return "before_author_note";
    case "in_chat":
      return "at_depth";
    case "after_char_def":
    default:
      return "after_character_definition";
  }
}

function mapPositionToken(
  raw: unknown,
): { position: NonNullable<LorebookEntry["position"]>; stPosition: number } {
  const num = readFiniteNumber(raw);
  if (num !== undefined) {
    switch (num) {
      case 0: return { position: "before_char_def", stPosition: 0 };
      case 1: return { position: "after_char_def", stPosition: 1 };
      case 2: return { position: "before_last_mes", stPosition: 2 };
      case 3: return { position: "after_char_def", stPosition: 3 };
      case 4: return { position: "in_chat", stPosition: 4 };
      case 5: return { position: "before_char_def", stPosition: 5 };
      case 6: return { position: "after_char_def", stPosition: 6 };
      default: return { position: "after_char_def", stPosition: 1 };
    }
  }
  switch (readString(raw)) {
    case "top":
    case "before_char_def":
    case "before_char":
    case "before_character_definition":
      return { position: "before_char_def", stPosition: 0 };
    case "before_example_messages":
      return { position: "before_char_def", stPosition: 5 };
    case "after_example_messages":
      return { position: "after_char_def", stPosition: 6 };
    case "before_last_mes":
    case "before_author_note":
      return { position: "before_last_mes", stPosition: 2 };
    case "after_author_note":
      return { position: "after_char_def", stPosition: 3 };
    case "in_chat":
    case "at_depth":
      return { position: "in_chat", stPosition: 4 };
    case "after_char_def":
    case "after_char":
    case "after_character_definition":
    default:
      return { position: "after_char_def", stPosition: 1 };
  }
}

function fromPositionToInternal(
  rawPosition: unknown,
): { position: NonNullable<LorebookEntry["position"]>; stPosition: number; depth?: number; order?: number; role?: TavernHelperWorldbookRole } {
  if (rawPosition && typeof rawPosition === "object" && !Array.isArray(rawPosition)) {
    const posRecord = asRecord(rawPosition);
    const depth = readFiniteNumber(posRecord.depth);
    const order = readFiniteNumber(posRecord.order);
    const roleRaw = posRecord.role;
    const role: TavernHelperWorldbookRole = roleRaw === "user" || roleRaw === "assistant" ? roleRaw : "system";
    return { ...mapPositionToken(posRecord.type), depth, order, role };
  }
  return mapPositionToken(rawPosition);
}

function toLowerSelectiveLogic(logic: LorebookEntry["selectiveLogic"]): TavernHelperSelectiveLogic {
  switch (logic) {
    case "AND_ALL": return "and_all";
    case "NOT_ANY": return "not_any";
    case "NOT_ALL": return "not_all";
    case "AND_ANY":
    default:
      return "and_any";
  }
}

function toUpperSelectiveLogic(raw: unknown, hasSecondaryKeys: boolean): LorebookEntry["selectiveLogic"] {
  const normalized = normalizeSelectiveLogic(raw);
  if (normalized) return normalized;
  return hasSecondaryKeys ? "AND_ANY" : "NONE";
}

function toStSelectiveLogicNumber(logic: LorebookEntry["selectiveLogic"]): number {
  switch (logic) {
    case "NOT_ALL": return 1;
    case "NOT_ANY": return 2;
    case "AND_ALL": return 3;
    case "AND_ANY":
    default:
      return 0;
  }
}

function readNullableNumberOverride(
  nested: unknown,
  flat: unknown,
  fallback: number | null | undefined,
): number | null {
  if (nested !== undefined) {
    return nested === null ? null : (readFiniteNumber(nested) ?? null);
  }
  if (flat !== undefined) {
    return flat === null ? null : (readFiniteNumber(flat) ?? null);
  }
  return fallback ?? null;
}

export function toTavernHelperWorldbookEntry(
  entry: LorebookEntry,
  index: number,
): TavernHelperWorldbookEntry {
  const uid = resolveEntryUid(entry, index);
  const enabled = entry.disabled !== true && entry.enabled !== false;
  const strategyType = entry.constant
    ? "constant"
    : sourceField(entry, "vectorized") === true
      ? "vectorized"
      : "selective";
  const scanDepth = typeof entry.scanDepth === "number"
    ? entry.scanDepth
    : readFiniteNumber(sourceField(entry, "scan_depth")) ?? "same_as_global";

  return {
    uid,
    name: entry.comment ?? "",
    enabled,
    strategy: {
      type: strategyType,
      keys: [...(entry.keys ?? [])],
      keys_secondary: {
        logic: toLowerSelectiveLogic(entry.selectiveLogic),
        keys: [...(entry.secondary_keys ?? [])],
      },
      scan_depth: scanDepth,
    },
    position: {
      type: toWorldbookPositionType(entry),
      role: toWorldbookRole(entry),
      depth: entry.depth ?? 4,
      order: entry.order ?? 100,
    },
    content: entry.content ?? "",
    probability: entry.probability ?? 100,
    recursion: {
      prevent_incoming: Boolean(
        entry.excludeRecursion ?? readBoolean(sourceField(entry, "exclude_recursion")) ?? false,
      ),
      prevent_outgoing: Boolean(
        entry.preventRecursion ?? readBoolean(sourceField(entry, "prevent_recursion")) ?? false,
      ),
      delay_until: entry.delayUntilRecursion
        ?? readFiniteNumber(sourceField(entry, "delay_until_recursion"))
        ?? null,
    },
    effect: {
      sticky: entry.sticky ?? readFiniteNumber(sourceField(entry, "sticky")) ?? null,
      cooldown: entry.cooldown ?? readFiniteNumber(sourceField(entry, "cooldown")) ?? null,
      delay: entry.delay ?? readFiniteNumber(sourceField(entry, "delay")) ?? null,
    },
  };
}

export function toTavernHelperLorebookEntry(
  entry: LorebookEntry,
  index: number,
): Record<string, unknown> {
  const wb = toTavernHelperWorldbookEntry(entry, index);
  return {
    uid: wb.uid,
    comment: wb.name,
    content: wb.content,
    keys: wb.strategy.keys,
    key: wb.strategy.keys,
    secondary_keys: wb.strategy.keys_secondary.keys,
    keysecondary: wb.strategy.keys_secondary.keys,
    enabled: wb.enabled,
    disable: !wb.enabled,
    constant: wb.strategy.type === "constant",
    type: wb.strategy.type,
    position: wb.position.type,
    role: wb.position.role,
    depth: wb.position.depth,
    order: wb.position.order,
    probability: wb.probability,
    selective: true,
    selective_logic: wb.strategy.keys_secondary.logic,
    scan_depth: wb.strategy.scan_depth === "same_as_global" ? null : wb.strategy.scan_depth,
    prevent_recursion: wb.recursion.prevent_outgoing,
    exclude_recursion: wb.recursion.prevent_incoming,
    delay_until_recursion: wb.recursion.delay_until,
    sticky: wb.effect.sticky,
    cooldown: wb.effect.cooldown,
    delay: wb.effect.delay,
    case_sensitive: entry.caseSensitive ?? null,
  };
}

export function fromTavernHelperWorldbookEntry(
  raw: unknown,
  existing: LorebookEntry | undefined,
  fallbackIndex: number,
): LorebookEntry {
  const record = asRecord(raw);
  const strategy = asRecord(record.strategy);
  const secondary = asRecord(strategy.keys_secondary);
  const recursion = asRecord(record.recursion);
  const effect = asRecord(record.effect);

  const rawUid = readFiniteNumber(record.uid);
  const uid = rawUid !== undefined && Number.isInteger(rawUid) && rawUid >= 0
    ? rawUid
    : existing ? resolveEntryUid(existing, fallbackIndex) : fallbackIndex;

  const primaryRaw = strategy.keys ?? record.keys ?? record.key ?? existing?.keys;
  const primaryNorm = normalizeKeyArray(primaryRaw);

  const secondaryRaw = secondary.keys ?? record.secondary_keys ?? record.keysecondary ?? existing?.secondary_keys;
  const secondaryNorm = normalizeKeyArray(secondaryRaw);

  const strategyType = readString(strategy.type) ?? readString(record.type);
  const constant = strategyType !== undefined
    ? strategyType === "constant"
    : (readBoolean(record.constant) ?? existing?.constant ?? false);
  const vectorized = strategyType === "vectorized";

  const enabled = record.disable !== undefined
    ? readBoolean(record.disable) !== true
    : (record.disabled !== undefined
        ? readBoolean(record.disabled) !== true
        : (readBoolean(record.enabled) ?? existing?.enabled ?? true));

  const comment = readString(record.name) ?? readString(record.comment) ?? existing?.comment ?? "";
  const content = readString(record.content) ?? readString(record.value) ?? existing?.content ?? "";
  const selectiveLogic = toUpperSelectiveLogic(
    secondary.logic ?? record.selective_logic ?? record.selectiveLogic ?? existing?.selectiveLogic,
    secondaryNorm.keys.length > 0,
  );

  const posResolved = record.position !== undefined
    ? fromPositionToInternal(record.position)
    : {
        position: existing?.position ?? "after_char_def",
        stPosition: readFiniteNumber(existing ? sourceField(existing, "position") : undefined) ?? 1,
        depth: existing?.depth,
        order: existing?.order,
        role: existing ? toWorldbookRole(existing) : "system" as const,
      };

  const depth = posResolved.depth ?? readFiniteNumber(record.depth) ?? existing?.depth ?? 4;
  const order = posResolved.order ?? readFiniteNumber(record.order) ?? existing?.order ?? 100;
  const probability = readFiniteNumber(record.probability) ?? existing?.probability ?? 100;

  const rawScanDepth = strategy.scan_depth !== undefined ? strategy.scan_depth : record.scan_depth;
  const scanDepth = rawScanDepth === "same_as_global"
    ? undefined
    : (readFiniteNumber(rawScanDepth) ?? existing?.scanDepth);

  const preventIncoming = readBoolean(recursion.prevent_incoming)
    ?? readBoolean(record.exclude_recursion)
    ?? readBoolean(record.excludeRecursion)
    ?? existing?.excludeRecursion
    ?? false;
  const preventOutgoing = readBoolean(recursion.prevent_outgoing)
    ?? readBoolean(record.prevent_recursion)
    ?? readBoolean(record.preventRecursion)
    ?? existing?.preventRecursion
    ?? false;
  const delayUntilRecursion = readNullableNumberOverride(
    recursion.delay_until,
    record.delay_until_recursion,
    existing?.delayUntilRecursion,
  );
  const sticky = readNullableNumberOverride(effect.sticky, record.sticky, existing?.sticky);
  const cooldown = readNullableNumberOverride(effect.cooldown, record.cooldown, existing?.cooldown);
  const delay = readNullableNumberOverride(effect.delay, record.delay, existing?.delay);

  const caseSensitive = readBoolean(record.case_sensitive)
    ?? readBoolean(record.caseSensitive)
    ?? existing?.caseSensitive
    ?? false;
  const useRegex = primaryNorm.hasRegExp
    || secondaryNorm.hasRegExp
    || (readBoolean(record.use_regex) ?? readBoolean(record.useRegex) ?? existing?.useRegex ?? false);

  const existingMeta = asRecord(existing?.sourceMetadata);
  const existingMetaExt = asRecord(existingMeta.extensions);
  const roleIndex = toStRoleIndex(posResolved.role ?? record.role ?? existingMeta.role);
  const sanitizedExtensions = stripForbiddenKeys({
    ...existingMetaExt,
    position: posResolved.stPosition,
    depth,
    probability,
    selectiveLogic: toStSelectiveLogicNumber(selectiveLogic),
    scan_depth: scanDepth,
    case_sensitive: caseSensitive,
    exclude_recursion: preventIncoming,
    prevent_recursion: preventOutgoing,
    delay_until_recursion: delayUntilRecursion,
    sticky,
    cooldown,
    delay,
    role: roleIndex,
    vectorized,
  }) as Record<string, unknown>;

  const entryId = readTrimmedString(record.id)
    ?? existing?.id
    ?? `wb_${uid}_${Math.random().toString(36).slice(2, 8)}`;

  return {
    ...(existing ?? {}),
    id: entryId,
    keys: primaryNorm.keys,
    secondary_keys: secondaryNorm.keys,
    selectiveLogic,
    caseSensitive,
    useRegex,
    scanDepth,
    content,
    constant,
    enabled,
    disabled: !enabled,
    comment,
    position: posResolved.position,
    depth,
    order,
    probability,
    sticky,
    cooldown,
    delay,
    excludeRecursion: preventIncoming,
    preventRecursion: preventOutgoing,
    delayUntilRecursion,
    sourceMetadata: {
      ...existingMeta,
      uid,
      role: roleIndex,
      position: posResolved.stPosition,
      vectorized,
      extensions: sanitizedExtensions,
    },
  };
}
