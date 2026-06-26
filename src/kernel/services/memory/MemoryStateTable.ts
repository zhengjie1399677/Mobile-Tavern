/**
 * MemoryStateTable - 状态表子模块（合并自 TableMemoryService）
 *
 * 物理职责：
 *   1. 解析 AI 输出中的结构化表格指令（updateRow / insertRow / deleteRow）
 *   2. 在内存中执行 CRUD 操作，产出更新后的 TableMemorySheet[]
 *   3. 提供默认表初始化能力（物品 / 关系 / 位置 / 任务等预定义表）
 *   4. 清理 AI 输出文本中的指令残留，避免污染对话展示
 *
 * 设计契约：
 *   - 纯计算服务，无网络 IO，无 IndexedDB 写入（状态表持久化由上层 session.save 负责）
 *   - 宽松 JSON 解析：兼容单引号、未引号键名、中文键名（角色卡场景常见）
 *   - 指令解析失败时静默降级（console.warn），不阻塞主对话流
 *   - 绑定 AbortSignal 仅为契约一致性，纯计算任务通常不实际触发 abort
 *
 * 与旧 TableMemoryService 的差异：
 *   - 新增 initDefaultSheets() / getSheet() / parseAICommand() 公共 API
 *   - 重构为接受 MemoryStorage 引用（为未来状态表持久化扩展预留）
 *   - 代码组织更内聚，便于未来抽离为独立微服务插件
 *
 * 详见 docs/记忆系统重构_架构设计_2026-06-27.md 第九章
 */

import type { TableMemorySheet } from '../../../types';
import type { MemoryStorage } from './MemoryStorage';

// ===== 常量 =====

/**
 * 表格指令匹配正则。
 *
 * 匹配格式：actionName("sheetName", { param1 }, { param2 }?)
 * - actionName: updateRow / insertRow / deleteRow（大小写不敏感）
 * - sheetName: 单引号 / 双引号 / 反引号包裹的字符串
 * - param1: JSON 对象（宽松解析，支持单引号和未引号键名）
 * - param2: 可选，仅 updateRow 双参数模式使用
 *
 * 注意：[\s\S]*? 非贪婪匹配，避免跨多个指令误吞。
 */
const TABLE_ACTION_REGEX =
  /(updateRow|insertRow|deleteRow)\s*\(\s*(['"`])(.*?)\2\s*,\s*(\{[\s\S]*?\})(?:\s*,\s*(\{[\s\S]*?\}))?\s*\)/gi;

/**
 * 默认表定义的列结构。
 * 预定义 4 张表覆盖常见 RP 场景，角色卡可在 visualSettings 中扩展自定义表。
 */
const DEFAULT_SHEETS_SCHEMA = [
  {
    id: 'sheet_relation',
    name: '关系',
    columns: ['角色', '好感度', '亲密度', '当前状态描述'],
    description: '记录角色与玩家（{{user}}）之间的好感状态和亲密关系定位',
  },
  {
    id: 'sheet_inventory',
    name: '物品',
    columns: ['物品名', '数量', '获得方式', '备注'],
    description: '记录玩家持有的关键物品及其来源',
  },
  {
    id: 'sheet_location',
    name: '位置',
    columns: ['地点', '区域', '到达方式', '描述'],
    description: '记录已探索的地点和当前所在位置',
  },
  {
    id: 'sheet_quest',
    name: '任务',
    columns: ['任务名', '状态', '触发条件', '备注'],
    description: '记录进行中、已完成、已失败的任务',
  },
] as const;

// ===== 类型 =====

/** 表格指令解析结果项 */
export interface ParsedTableAction {
  /** 指令类型 */
  type: 'updateRow' | 'insertRow' | 'deleteRow';
  /** 目标表名 */
  sheetName: string;
  /** 第一参数（过滤条件 或 修改值） */
  param1: Record<string, any>;
  /** 第二参数（仅 updateRow 双参数模式存在） */
  param2?: Record<string, any> | null;
  /** 原始匹配文本（用于清理） */
  raw: string;
}

/** processTableMemory 返回结果 */
export interface ProcessTableResult {
  updatedMemory: TableMemorySheet[];
  cleanContent: string;
  hasChanges: boolean;
}

// ===== MemoryStateTable 类 =====

export class MemoryStateTable {
  /** 持有 MemoryStorage 引用，为未来状态表持久化扩展预留 */
  private storage: MemoryStorage;
  /** 服务级 AbortController（纯计算服务，契约一致性） */
  private abortController: AbortController | null = null;

  constructor(storage: MemoryStorage) {
    this.storage = storage;
  }

  /**
   * 初始化状态表。
   * 纯计算服务无异步 IO，AbortSignal 仅作契约一致性绑定。
   */
  init(signal?: AbortSignal): void {
    this.abortController = new AbortController();
    if (signal) {
      if (signal.aborted) this.abortController.abort();
      else signal.addEventListener('abort', () => this.abortController?.abort());
    }
  }

  /**
   * 销毁子模块。
   * 纯计算服务无异步任务，仅清理 abortController。
   * 保留已 aborted 的实例（与 MemoryExtractor 一致），让后续调用能识别销毁状态。
   */
  destroy(signal?: AbortSignal): void {
    if (signal) {
      if (signal.aborted) this.abortController?.abort();
      else signal.addEventListener('abort', () => this.abortController?.abort());
    }
    this.abortController?.abort();
  }

  /**
   * 生成默认表数组。
   * 当会话首次启用状态表功能时调用，注入预定义 4 张表。
   *
   * @param characterName 角色名（用于"关系"表的初始行）
   * @returns 默认表数组（深拷贝，调用方可安全修改）
   */
  initDefaultSheets(characterName: string = '角色'): TableMemorySheet[] {
    return DEFAULT_SHEETS_SCHEMA.map((schema) => ({
      id: schema.id,
      name: schema.name,
      columns: [...schema.columns],
      rows:
        schema.id === 'sheet_relation'
          ? [[characterName, '50', '相识', '初次结识，关系尚显生疏']]
          : [],
      enable: true,
      description: schema.description,
    }));
  }

  /**
   * 按名查询表。
   *
   * @param sheets 表数组
   * @param name 表名
   * @returns 匹配的表，未找到返回 undefined
   */
  getSheet(sheets: TableMemorySheet[], name: string): TableMemorySheet | undefined {
    return sheets.find((s) => s.name === name);
  }

  /**
   * 解析 AI 输出中的表格指令（仅解析，不执行 CRUD）。
   * 供中间件预检测使用，避免无指令时调用 processTableMemory。
   *
   * @param rawContent AI 原始输出
   * @returns 解析出的指令列表（解析失败的指令被跳过）
   */
  parseAICommand(rawContent: string): ParsedTableAction[] {
    if (!rawContent) return [];

    const actions: ParsedTableAction[] = [];
    const regex = new RegExp(TABLE_ACTION_REGEX.source, 'gi');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(rawContent)) !== null) {
      const fullMatch = match[0];
      const actionType = match[1].toLowerCase() as ParsedTableAction['type'];
      const sheetName = match[3];
      const param1Str = match[4];
      const param2Str = match[5];

      try {
        const param1 = parseLooseJson(param1Str);
        const param2 = param2Str ? parseLooseJson(param2Str) : null;
        actions.push({
          type: actionType,
          sheetName,
          param1,
          param2: param2 ?? undefined,
          raw: fullMatch,
        });
      } catch (e) {
        console.warn(
          `[MemoryStateTable] Action parse failed: ${actionType} on ${sheetName}:`,
          e
        );
      }
    }

    return actions;
  }

  /**
   * 处理 AI 输出中的表格指令，执行 CRUD 并清理文本。
   *
   * 算法：
   *   1. 深拷贝输入表数组（避免污染调用方数据）
   *   2. 全局正则扫描所有 updateRow / insertRow / deleteRow 指令
   *   3. 逐条解析参数（宽松 JSON），按 sheetName 定位目标表
   *   4. 在内存中执行 CRUD（updateRow 支持单参数/双参数两种模式）
   *   5. 从原始文本中移除所有指令残留，压缩多余空行
   *
   * @param tableMemory 当前表数组
   * @param rawContent AI 原始输出
   * @returns 更新后的表数组 + 清理后的文本 + 是否有变更
   */
  processTableMemory(
    tableMemory: TableMemorySheet[] = [],
    rawContent: string
  ): ProcessTableResult {
    let cleanContent = rawContent;
    let hasChanges = false;

    // 深拷贝输入表数组，避免污染调用方数据
    const currentMemory: TableMemorySheet[] = tableMemory.map((s) => ({
      ...s,
      columns: [...s.columns],
      rows: s.rows.map((r) => [...r]),
    }));

    const matchesToClean: string[] = [];
    const regex = new RegExp(TABLE_ACTION_REGEX.source, 'gi');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(rawContent)) !== null) {
      const fullMatch = match[0];
      const actionType = match[1].toLowerCase();
      const sheetName = match[3];
      const param1Str = match[4];
      const param2Str = match[5];

      matchesToClean.push(fullMatch);

      try {
        const p1 = parseLooseJson(param1Str);
        const p2 = param2Str ? parseLooseJson(param2Str) : null;

        const sheetIndex = currentMemory.findIndex((s) => s.name === sheetName);
        if (sheetIndex === -1) continue;

        const sheet = currentMemory[sheetIndex];

        if (actionType === 'updaterow') {
          if (p2) {
            // updateRow("sheet", {"定位列": "值"}, {"修改列": "新值"})
            sheet.rows = sheet.rows.map((row) => {
              const matchesFilter = Object.entries(p1).every(
                ([filterKey, filterVal]) => {
                  const colIdx = sheet.columns.indexOf(filterKey);
                  return colIdx !== -1 && String(row[colIdx]) === String(filterVal);
                }
              );
              if (matchesFilter) {
                hasChanges = true;
                const nextRow = [...row];
                Object.entries(p2).forEach(([key, val]) => {
                  const colIdx = sheet.columns.indexOf(key);
                  if (colIdx !== -1) {
                    nextRow[colIdx] = String(val);
                  }
                });
                return nextRow;
              }
              return row;
            });
          } else {
            // updateRow("sheet", {"修改列": "新值"}) — 默认更新第一行
            if (sheet.rows.length === 0) {
              sheet.rows.push(sheet.columns.map(() => ''));
            }
            Object.entries(p1).forEach(([key, val]) => {
              const colIdx = sheet.columns.indexOf(key);
              if (colIdx !== -1) {
                sheet.rows[0][colIdx] = String(val);
                hasChanges = true;
              }
            });
          }
        } else if (actionType === 'insertrow') {
          // insertRow("sheet", {"col1": "val1"})
          const newRow = sheet.columns.map(
            (col) => (p1[col] !== undefined ? String(p1[col]) : '')
          );
          sheet.rows.push(newRow);
          hasChanges = true;
        } else if (actionType === 'deleterow') {
          // deleteRow("sheet", {"col1": "val1"})
          const prevLen = sheet.rows.length;
          sheet.rows = sheet.rows.filter((row) => {
            const matchesFilter = Object.entries(p1).every(
              ([filterKey, filterVal]) => {
                const colIdx = sheet.columns.indexOf(filterKey);
                return colIdx !== -1 && String(row[colIdx]) === String(filterVal);
              }
            );
            return !matchesFilter;
          });
          if (sheet.rows.length !== prevLen) {
            hasChanges = true;
          }
        }
      } catch (e) {
        console.warn(
          `[MemoryStateTable] Action parse failed: ${actionType} on ${sheetName}:`,
          e
        );
      }
    }

    // 清理指令残留
    matchesToClean.forEach((m) => {
      cleanContent = cleanContent.replace(m, '');
    });
    cleanContent = cleanContent.replace(/\n{3,}/g, '\n\n').trim();

    return {
      updatedMemory: currentMemory,
      cleanContent,
      // hasChanges 仅在指令真的修改了表内容时为 true；
      // 指令被清理但无实际表变更（如引用不存在的表名）不算 hasChanges
      hasChanges,
    };
  }
}

// ===== 内部工具函数 =====

/**
 * 宽松 JSON 解析。
 *
 * 兼容场景：
 *   - 单引号字符串 → 双引号
 *   - 未引号键名（含中文） → 双引号包裹
 *
 * @param str 待解析的 JSON 字符串
 * @returns 解析后的对象
 * @throws 解析失败抛出 SyntaxError
 */
function parseLooseJson(str: string): Record<string, any> {
  const formatted = str
    .replace(/'/g, '"')
    .replace(/([{,]\s*)([a-zA-Z0-9_\u4e00-\u9fa5]+)\s*:/g, '$1"$2":');
  return JSON.parse(formatted);
}
