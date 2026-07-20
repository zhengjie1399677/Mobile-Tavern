import type {
  TableMemoryColumnDefinition,
  TableMemoryColumnType,
  TableMemorySheet,
} from "../../types";

export const TABLE_MEMORY_SCHEMA_KIND = "mobile-tavern-table-schema";
export const TABLE_MEMORY_SCHEMA_VERSION = 1;

const COLUMN_TYPES: readonly TableMemoryColumnType[] = ["text", "number", "date", "enum"];
const MAX_SHEETS = 50;
const MAX_COLUMNS = 50;
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_DEFAULT_LENGTH = 500;
const MAX_ENUM_OPTIONS = 50;
const MAX_ENUM_OPTION_LENGTH = 100;

export interface TableMemorySchemaTemplateSheet {
  name: string;
  description?: string;
  enable: boolean;
  columns: TableMemoryColumnDefinition[];
}

export interface TableMemorySchemaPackage {
  kind: typeof TABLE_MEMORY_SCHEMA_KIND;
  version: typeof TABLE_MEMORY_SCHEMA_VERSION;
  exportedAt: string;
  sheets: TableMemorySchemaTemplateSheet[];
}

export interface CoercedTableMemoryValue {
  value: string;
  valid: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isColumnType = (value: unknown): value is TableMemoryColumnType =>
  typeof value === "string" && COLUMN_TYPES.includes(value as TableMemoryColumnType);

const createStableColumnId = (index: number): string => `column_${index + 1}`;

export function createTableMemoryColumn(
  name: string,
  type: TableMemoryColumnType = "text",
  id = `column_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
): TableMemoryColumnDefinition {
  return { id, name, type };
}

/** 将旧版 columns 字符串数组按需升级为带稳定 ID 的 text Schema。 */
export function getTableMemoryColumnDefinitions(
  sheet: Pick<TableMemorySheet, "columns" | "columnDefinitions">
): TableMemoryColumnDefinition[] {
  const definitions = Array.isArray(sheet.columnDefinitions) ? sheet.columnDefinitions : [];
  const usedIds = new Set<string>();

  return (Array.isArray(sheet.columns) ? sheet.columns : []).map((columnName, index) => {
    const byPosition = definitions[index];
    const byName = definitions.find((definition) => definition?.name === columnName);
    const source = byPosition?.name === columnName ? byPosition : byName;
    let id = typeof source?.id === "string" && source.id.trim() ? source.id.trim() : createStableColumnId(index);
    if (usedIds.has(id)) id = `${id}_${index + 1}`;
    usedIds.add(id);

    return normalizeColumnDefinition({
      id,
      name: String(columnName ?? ""),
      type: source?.type,
      defaultValue: source?.defaultValue,
      enumOptions: source?.enumOptions,
    }, index);
  });
}

export function normalizeTableMemorySheet(sheet: TableMemorySheet): TableMemorySheet {
  const definitions = getTableMemoryColumnDefinitions(sheet);
  return {
    ...sheet,
    columns: definitions.map((definition) => definition.name),
    columnDefinitions: definitions,
    rows: Array.isArray(sheet.rows)
      ? sheet.rows.map((row) => definitions.map((_, index) => String(row?.[index] ?? "")))
      : [],
  };
}

/**
 * 将输入值转换为列的存储字符串。无效 number/date/enum 返回 valid=false；
 * 调用方可在迁移时保留原值，在新写入时选择跳过或使用默认值。
 */
export function coerceTableMemoryValue(
  input: unknown,
  definition: TableMemoryColumnDefinition
): CoercedTableMemoryValue {
  const raw = input === null || input === undefined ? "" : String(input).trim();
  const fallback = definition.defaultValue ?? "";

  if (!raw) return { value: fallback, valid: true };
  if (definition.type === "text") return { value: String(input ?? ""), valid: true };

  if (definition.type === "number") {
    const parsed = Number(raw);
    return Number.isFinite(parsed)
      ? { value: String(parsed), valid: true }
      : { value: fallback, valid: false };
  }

  if (definition.type === "date") {
    return isValidIsoDate(raw)
      ? { value: raw, valid: true }
      : { value: fallback, valid: false };
  }

  const options = definition.enumOptions ?? [];
  return options.includes(raw)
    ? { value: raw, valid: true }
    : { value: fallback, valid: false };
}

export function createDefaultTableMemoryRow(sheet: TableMemorySheet): string[] {
  return getTableMemoryColumnDefinitions(sheet).map((definition) => definition.defaultValue ?? "");
}

/** 按稳定列 ID 迁移数据；无法满足新类型的历史值原样保留，避免升级时静默丢失。 */
export function migrateTableMemorySheetSchema(
  sheet: TableMemorySheet,
  nextDefinitions: TableMemoryColumnDefinition[]
): TableMemorySheet {
  const previousDefinitions = getTableMemoryColumnDefinitions(sheet);
  const normalizedNext = nextDefinitions.map(normalizeColumnDefinition);
  const rows = (Array.isArray(sheet.rows) ? sheet.rows : []).map((oldRow) =>
    normalizedNext.map((nextDefinition) => {
      const oldIndex = previousDefinitions.findIndex((definition) => definition.id === nextDefinition.id);
      if (oldIndex === -1) return nextDefinition.defaultValue ?? "";
      const oldValue = String(oldRow?.[oldIndex] ?? "");
      const coerced = coerceTableMemoryValue(oldValue, nextDefinition);
      return coerced.valid ? coerced.value : oldValue;
    })
  );

  return {
    ...sheet,
    columns: normalizedNext.map((definition) => definition.name),
    columnDefinitions: normalizedNext,
    rows,
  };
}

export function serializeTableMemorySchema(sheets: TableMemorySheet[]): string {
  const pkg: TableMemorySchemaPackage = {
    kind: TABLE_MEMORY_SCHEMA_KIND,
    version: TABLE_MEMORY_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    sheets: sheets.map((sheet) => ({
      name: String(sheet.name ?? "").trim(),
      description: sheet.description?.trim() || undefined,
      enable: sheet.enable !== false,
      columns: getTableMemoryColumnDefinitions(sheet),
    })),
  };
  return JSON.stringify(pkg, null, 2);
}

/** 外部 Schema 包防腐入口：严格校验结构、长度、重复名称和默认值。 */
export function parseTableMemorySchema(input: string | unknown): TableMemorySchemaPackage {
  let value: unknown = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch {
      throw new Error("SCHEMA_INVALID_JSON");
    }
  }
  if (!isRecord(value) || value.kind !== TABLE_MEMORY_SCHEMA_KIND || value.version !== TABLE_MEMORY_SCHEMA_VERSION) {
    throw new Error("SCHEMA_UNSUPPORTED_FORMAT");
  }
  if (!Array.isArray(value.sheets) || value.sheets.length === 0 || value.sheets.length > MAX_SHEETS) {
    throw new Error("SCHEMA_INVALID_SHEETS");
  }

  const names = new Set<string>();
  const sheets = value.sheets.map((rawSheet, sheetIndex): TableMemorySchemaTemplateSheet => {
    if (!isRecord(rawSheet)) throw new Error("SCHEMA_INVALID_SHEET");
    const name = requireBoundedString(rawSheet.name, MAX_NAME_LENGTH, "SCHEMA_INVALID_SHEET_NAME");
    if (names.has(name)) throw new Error("SCHEMA_DUPLICATE_SHEET_NAME");
    names.add(name);
    if (!Array.isArray(rawSheet.columns) || rawSheet.columns.length === 0 || rawSheet.columns.length > MAX_COLUMNS) {
      throw new Error("SCHEMA_INVALID_COLUMNS");
    }

    const columnNames = new Set<string>();
    const columnIds = new Set<string>();
    const columns = rawSheet.columns.map((rawColumn, columnIndex) => {
      if (!isRecord(rawColumn)) throw new Error("SCHEMA_INVALID_COLUMN");
      const definition = parseExternalColumn(rawColumn, sheetIndex, columnIndex);
      if (columnNames.has(definition.name) || columnIds.has(definition.id)) {
        throw new Error("SCHEMA_DUPLICATE_COLUMN");
      }
      columnNames.add(definition.name);
      columnIds.add(definition.id);
      return definition;
    });

    const description = rawSheet.description === undefined
      ? undefined
      : requireBoundedString(rawSheet.description, MAX_DESCRIPTION_LENGTH, "SCHEMA_INVALID_DESCRIPTION", true);
    return {
      name,
      description: description || undefined,
      enable: rawSheet.enable !== false,
      columns,
    };
  });

  return {
    kind: TABLE_MEMORY_SCHEMA_KIND,
    version: TABLE_MEMORY_SCHEMA_VERSION,
    exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : "",
    sheets,
  };
}

export function instantiateTableMemorySchema(
  pkg: TableMemorySchemaPackage,
  existingNames: readonly string[] = []
): TableMemorySheet[] {
  const occupied = new Set(existingNames);
  return pkg.sheets.map((template, index) => {
    let name = template.name;
    let suffix = 2;
    while (occupied.has(name)) name = `${template.name} (${suffix++})`;
    occupied.add(name);
    const columnDefinitions = template.columns.map((column) => ({ ...column, enumOptions: column.enumOptions ? [...column.enumOptions] : undefined }));
    return {
      id: `sheet_imported_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      description: template.description,
      enable: template.enable,
      columns: columnDefinitions.map((column) => column.name),
      columnDefinitions,
      rows: [],
    };
  });
}

export function formatTableMemoryColumnConstraint(definition: TableMemoryColumnDefinition): string {
  const details: string[] = [definition.type];
  if (definition.type === "enum" && definition.enumOptions?.length) {
    details.push(`options=${definition.enumOptions.join("/")}`);
  }
  if (definition.defaultValue) details.push(`default=${definition.defaultValue}`);
  return `${definition.name}<${details.join(", ")}>`;
}

function normalizeColumnDefinition(
  definition: Partial<TableMemoryColumnDefinition>,
  index = 0
): TableMemoryColumnDefinition {
  const type = isColumnType(definition.type) ? definition.type : "text";
  const enumOptions = type === "enum"
    ? normalizeEnumOptions(definition.enumOptions)
    : undefined;
  let defaultValue = typeof definition.defaultValue === "string"
    ? definition.defaultValue.slice(0, MAX_DEFAULT_LENGTH)
    : "";
  const candidate: TableMemoryColumnDefinition = {
    id: String(definition.id || createStableColumnId(index)).trim(),
    name: String(definition.name ?? "").trim(),
    type,
    defaultValue: defaultValue || undefined,
    enumOptions,
  };
  if (defaultValue && !coerceTableMemoryValue(defaultValue, { ...candidate, defaultValue: "" }).valid) {
    defaultValue = "";
  }
  return { ...candidate, defaultValue: defaultValue || undefined };
}

function parseExternalColumn(
  value: Record<string, unknown>,
  sheetIndex: number,
  columnIndex: number
): TableMemoryColumnDefinition {
  const name = requireBoundedString(value.name, MAX_NAME_LENGTH, "SCHEMA_INVALID_COLUMN_NAME");
  if (!isColumnType(value.type)) throw new Error("SCHEMA_INVALID_COLUMN_TYPE");
  const id = typeof value.id === "string" && value.id.trim()
    ? value.id.trim().slice(0, MAX_NAME_LENGTH)
    : `imported_${sheetIndex + 1}_${columnIndex + 1}`;
  const enumOptions = value.type === "enum" ? normalizeEnumOptionsStrict(value.enumOptions) : undefined;
  const defaultValue = value.defaultValue === undefined
    ? undefined
    : requireBoundedString(value.defaultValue, MAX_DEFAULT_LENGTH, "SCHEMA_INVALID_DEFAULT", true);
  const definition = { id, name, type: value.type, defaultValue: defaultValue || undefined, enumOptions };
  if (defaultValue && !coerceTableMemoryValue(defaultValue, { ...definition, defaultValue: "" }).valid) {
    throw new Error("SCHEMA_INVALID_DEFAULT");
  }
  return definition;
}

function normalizeEnumOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((option): option is string => typeof option === "string").map((option) => option.trim().slice(0, MAX_ENUM_OPTION_LENGTH)).filter(Boolean))]
    .slice(0, MAX_ENUM_OPTIONS);
}

function normalizeEnumOptionsStrict(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ENUM_OPTIONS) {
    throw new Error("SCHEMA_ENUM_OPTIONS_REQUIRED");
  }
  const options = value.map((option) =>
    requireBoundedString(option, MAX_ENUM_OPTION_LENGTH, "SCHEMA_INVALID_ENUM_OPTION")
  );
  if (new Set(options).size !== options.length) throw new Error("SCHEMA_DUPLICATE_ENUM_OPTION");
  return options;
}

function requireBoundedString(
  value: unknown,
  maxLength: number,
  errorCode: string,
  allowEmpty = false
): string {
  if (typeof value !== "string") throw new Error(errorCode);
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || normalized.length > maxLength) throw new Error(errorCode);
  return normalized;
}

function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
