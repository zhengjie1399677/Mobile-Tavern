import { assert } from "./testUtils";
import type { TableMemoryColumnDefinition, TableMemorySheet } from "../../src/types";
import type { MemoryStorage } from "../../src/kernel/services/memory/MemoryStorage";
import { MemoryStateTable } from "../../src/kernel/services/memory/MemoryStateTable";
import {
  coerceTableMemoryValue,
  createDefaultTableMemoryRow,
  getTableMemoryColumnDefinitions,
  instantiateTableMemorySchema,
  migrateTableMemorySheetSchema,
  parseTableMemorySchema,
  serializeTableMemorySchema,
} from "../../src/domain/memory/tableMemorySchema";

export async function testTableMemorySchema(): Promise<void> {
  console.log("\n--- Running TableMemory Schema Verification ---");

  const legacySheet: TableMemorySheet = {
    id: "legacy",
    name: "旧状态表",
    columns: ["角色", "好感度"],
    rows: [["Alice", "未知"]],
    enable: true,
  };

  const legacyDefinitions = getTableMemoryColumnDefinitions(legacySheet);
  assert(legacyDefinitions.length === 2, "旧表应按列数生成 Schema");
  assert(legacyDefinitions.every((column) => column.type === "text"), "旧列应降级为 text");

  const nextDefinitions: TableMemoryColumnDefinition[] = [
    { ...legacyDefinitions[0], name: "人物", type: "text" },
    { ...legacyDefinitions[1], type: "number", defaultValue: "50" },
    { id: "status", name: "状态", type: "enum", defaultValue: "正常", enumOptions: ["正常", "异常"] },
  ];
  const migrated = migrateTableMemorySheetSchema(legacySheet, nextDefinitions);
  assert(migrated.rows[0][0] === "Alice", "列重命名应凭稳定 ID 保留旧值");
  assert(migrated.rows[0][1] === "未知", "无法转换的历史 number 值应原样保留");
  assert(migrated.rows[0][2] === "正常", "新增列应填充默认值");
  assert(createDefaultTableMemoryRow(migrated).join("|") === "|50|正常", "新增行应使用列默认值");

  const numberColumn = nextDefinitions[1];
  assert(coerceTableMemoryValue("12.50", numberColumn).value === "12.5", "number 应规范化");
  assert(coerceTableMemoryValue("bad", numberColumn).valid === false, "非法 number 应被拒绝");
  assert(
    coerceTableMemoryValue("异常", nextDefinitions[2]).valid === true &&
      coerceTableMemoryValue("其他", nextDefinitions[2]).valid === false,
    "enum 只接受声明选项"
  );

  const serialized = serializeTableMemorySchema([migrated]);
  assert(!serialized.includes("Alice"), "Schema 包不得携带会话行数据");
  const parsed = parseTableMemorySchema(serialized);
  assert(parsed.sheets[0].columns[1].type === "number", "导出导入应保留字段类型");
  const instantiated = instantiateTableMemorySchema(parsed, ["旧状态表"]);
  assert(instantiated[0].name === "旧状态表 (2)", "导入同名模板应安全重命名");
  assert(instantiated[0].rows.length === 0, "模板实例不得恢复来源会话数据");

  let invalidRejected = false;
  try {
    parseTableMemorySchema({
      ...parsed,
      sheets: [{
        ...parsed.sheets[0],
        columns: [{ id: "bad", name: "坏列", type: "enum", enumOptions: [] }],
      }],
    });
  } catch {
    invalidRejected = true;
  }
  assert(invalidRejected, "外部 enum Schema 缺少选项时必须被防腐层拒绝");

  const stateTable = new MemoryStateTable({} as MemoryStorage);
  const typedSheet: TableMemorySheet = {
    id: "typed",
    name: "类型表",
    columns: ["数量", "日期", "状态"],
    columnDefinitions: [
      { id: "quantity", name: "数量", type: "number", defaultValue: "1" },
      { id: "date", name: "日期", type: "date" },
      { id: "status", name: "状态", type: "enum", defaultValue: "待定", enumOptions: ["待定", "完成"] },
    ],
    rows: [],
    enable: true,
  };
  const inserted = stateTable.processTableMemory(
    [typedSheet],
    `insertRow("类型表", {"日期": "2026-07-20"})`
  ).updatedMemory[0];
  assert(inserted.rows[0].join("|") === "1|2026-07-20|待定", "LLM 插入应应用类型化默认值");
  const rejected = stateTable.processTableMemory(
    [inserted],
    `updateRow("类型表", {"数量": "not-a-number"})`
  );
  assert(rejected.hasChanges === false, "非法类型更新不应污染状态表");
  assert(rejected.updatedMemory[0].rows[0][0] === "1", "非法 number 更新应保留旧值");

  console.log("✔ TableMemory Schema verified successfully!");
}
