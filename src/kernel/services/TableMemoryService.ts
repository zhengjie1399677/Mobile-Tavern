/**
 * @deprecated 逻辑已合并到 MemoryService.getStateTable()，本文件暂存作为向后兼容入口。
 */

import { IKernel } from "../types";
import { CharacterCard, TableMemorySheet } from "../../types";

// @deprecated — 不再 implements ITableMemoryService（该接口已从 kernel/types.ts 清理）
export class TableMemoryService {
  name = "tableMemory";
  private kernel!: IKernel;
  // P1-1/P1-2: 服务级 AbortController（纯计算服务，契约一致性）
  private abortController: AbortController | null = null;

  /**
   * 初始化状态表内存服务
   */
  init(kernel: IKernel, signal?: AbortSignal): void {
    this.kernel = kernel;
    this.abortController = new AbortController();
    if (signal) {
      if (signal.aborted) this.abortController.abort();
      else signal.addEventListener("abort", () => this.abortController?.abort());
    }
  }

  /**
   * 销毁状态表内存服务
   */
  destroy(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  /**
   * 解析并处理 AI 回复中的状态表更新指令（updateRow, insertRow, deleteRow）
   * 提取指令并更新表格数据，同时清理文本中的指令残留以交付干净的回复给 UI
   */
  processTableMemory(
    tableMemory: TableMemorySheet[] = [],
    rawContent: string,
    activeCharacter?: CharacterCard
  ): { updatedMemory: TableMemorySheet[]; cleanContent: string; hasChanges: boolean } {
    let cleanContent = rawContent;
    let hasChanges = false;
    const currentMemory = tableMemory.map(s => ({
      ...s,
      columns: [...s.columns],
      rows: s.rows.map(r => [...r])
    }));

    // 正则表达式用于扫描内存状态表的更新指令：例如 updateRow("sheet", {...})
    // 匹配 updateRow、insertRow、deleteRow (不区分大小写)
    const actionRegex = /(updateRow|insertRow|deleteRow)\s*\(\s*(['"`])(.*?)\2\s*,\s*(\{[\s\S]*?\})(?:\s*,\s*(\{[\s\S]*?\}))?\s*\)/gi;

    let match;
    const matchesToClean: string[] = [];

    while ((match = actionRegex.exec(rawContent)) !== null) {
      const fullMatch = match[0];
      const actionType = match[1].toLowerCase();
      const sheetName = match[3];
      const param1Str = match[4];
      const param2Str = match[5];

      matchesToClean.push(fullMatch);

      try {
        // 宽松的 JSON 解析：支持单引号以及无引号的中文/英文键名解析
        const parseJsonObj = (str: string) => {
          const formatted = str
            .replace(/'/g, '"')
            .replace(/([{,]\s*)([a-zA-Z0-9_\u4e00-\u9fa5]+)\s*:/g, '$1"$2":');
          return JSON.parse(formatted);
        };

        const p1 = parseJsonObj(param1Str);
        const p2 = param2Str ? parseJsonObj(param2Str) : null;

        const sheetIndex = currentMemory.findIndex(s => s.name === sheetName);
        if (sheetIndex !== -1) {
          const sheet = currentMemory[sheetIndex];

          if (actionType === "updaterow") {
            if (p2) {
              // 双参数模式：updateRow("sheet", {"定位列": "值"}, {"修改列": "新值"})
              sheet.rows = sheet.rows.map(row => {
                const matchesFilter = Object.entries(p1).every(([filterKey, filterVal]) => {
                  const colIdx = sheet.columns.indexOf(filterKey);
                  return colIdx !== -1 && String(row[colIdx]) === String(filterVal);
                });
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
              // 单参数模式：updateRow("sheet", {"修改列": "新值"}) (默认更新第一行)
              if (sheet.rows.length === 0) {
                sheet.rows.push(sheet.columns.map(() => ""));
              }
              Object.entries(p1).forEach(([key, val]) => {
                const colIdx = sheet.columns.indexOf(key);
                if (colIdx !== -1) {
                  sheet.rows[0][colIdx] = String(val);
                  hasChanges = true;
                }
              });
            }
          } else if (actionType === "insertrow") {
            // 插入行模式：insertRow("sheet", {"列名": "数值"})
            const newRow = sheet.columns.map(col => {
              return p1[col] !== undefined ? String(p1[col]) : "";
            });
            sheet.rows.push(newRow);
            hasChanges = true;
          } else if (actionType === "deleterow") {
            // 删除行模式：deleteRow("sheet", {"定位列": "值"})
            const prevLen = sheet.rows.length;
            sheet.rows = sheet.rows.filter(row => {
              const matchesFilter = Object.entries(p1).every(([filterKey, filterVal]) => {
                const colIdx = sheet.columns.indexOf(filterKey);
                return colIdx !== -1 && String(row[colIdx]) === String(filterVal);
              });
              return !matchesFilter;
            });
            if (sheet.rows.length !== prevLen) {
              hasChanges = true;
            }
          }
        }
      } catch (e) {
        console.warn(`[TableMemory] 指令解析失败: ${actionType} 在表 ${sheetName} 上:`, e);
      }
    }

    matchesToClean.forEach(m => {
      cleanContent = cleanContent.replace(m, "");
    });

    cleanContent = cleanContent.replace(/\n{3,}/g, "\n\n").trim();
    return { updatedMemory: currentMemory, cleanContent, hasChanges: hasChanges || cleanContent !== rawContent };
  }
}
