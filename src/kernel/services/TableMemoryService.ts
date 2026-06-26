/**
 * @deprecated 阶段 C 已废弃，逻辑合并到 MemoryService.getStateTable() 子模块。
 *
 * 本文件保留 1 个版本周期用于回归测试与渐进式迁移，新代码请勿引用。
 * 下个版本周期后将删除。
 *
 * 迁移指南：
 *   - 旧：kernel.getService(KernelServices.TableMemory).processTableMemory(...)
 *   - 新：kernel.getService(KernelServices.Memory).getStateTable().processTableMemory(...)
 *   - 新增能力：initDefaultSheets() / getSheet() / parseAICommand()
 *
 * 详见 docs/记忆系统重构_架构设计_2026-06-27.md 第九章 + 第十八章 18.3 节
 */

import { ITableMemoryService, IKernel } from "../types";
import { CharacterCard, TableMemorySheet } from "../../types";

export class TableMemoryService implements ITableMemoryService {
  name = "tableMemory";
  private kernel!: IKernel;
  // P1-1/P1-2: 服务级 AbortController（纯计算服务，契约一致性）
  private abortController: AbortController | null = null;

  init(kernel: IKernel, signal?: AbortSignal): void {
    this.kernel = kernel;
    this.abortController = new AbortController();
    if (signal) {
      if (signal.aborted) this.abortController.abort();
      else signal.addEventListener("abort", () => this.abortController?.abort());
    }
  }

  destroy(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

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

    // Regular expression to scan memory update actions: e.g. updateRow("sheet", {...})
    // matches updateRow, insertRow, deleteRow (case-insensitive)
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
        // Relaxed JSON parsing: replace single quotes and unquoted keys
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
              // updateRow("sheet", {"定位列": "值"}, {"修改列": "新值"})
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
              // updateRow("sheet", {"修改列": "新值"}) (default updates first row)
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
            // insertRow("sheet", {"col1": "val1"})
            const newRow = sheet.columns.map(col => {
              return p1[col] !== undefined ? String(p1[col]) : "";
            });
            sheet.rows.push(newRow);
            hasChanges = true;
          } else if (actionType === "deleterow") {
            // deleteRow("sheet", {"col1": "val1"})
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
        console.warn(`[TableMemory] Action parse failed: ${actionType} on ${sheetName}:`, e);
      }
    }

    matchesToClean.forEach(m => {
      cleanContent = cleanContent.replace(m, "");
    });

    cleanContent = cleanContent.replace(/\n{3,}/g, "\n\n").trim();
    return { updatedMemory: currentMemory, cleanContent, hasChanges: hasChanges || cleanContent !== rawContent };
  }
}
