/**
 * mvuParser.ts — MVU 命令解析引擎
 *
 * 职责：
 * - 从 AI 回复文本中提取标准 MVU 命令（_.set / _.add / _.delete / _.insert / _.move）
 * - 解析 XML 标签内的 MVU 命令（兼容 SillyTavern <UpdateVariable> / <initvar> 方言）
 * - 检测并应用 JSON Patch (RFC 6902) 格式的变量更新指令
 * - 将解析后的命令应用到 stat_data 上，生成新的变量快照
 *
 * 设计原则：
 * - 纯函数模块：所有导出函数均无副作用，仅依赖 lodash 工具库和 JSON5
 * - 防腐隔离：对 SillyTavern 外部卡片格式做统一清洗后再进入核心解析管道
 * - 深拷贝保护：parseMvuMessage 返回全新对象，不污染原始输入
 */

import lodashCloneDeep from "lodash/cloneDeep";
import lodashGet from "lodash/get";
import lodashSet from "lodash/set";
import lodashUnset from "lodash/unset";
import JSON5 from "json5";

// ──────────────────────────────────────────────────────────────────────────────
// AbortSignal 协作式中断检查点（TODO #5）
// ──────────────────────────────────────────────────────────────────────────────

/**
 * 构造标准的 AbortError，兼容缺失 DOMException 的环境。
 * 与 localDB.ts 中的 createAbortError 保持行为一致以统一错误识别。
 */
function createAbortError(message = "MVU parsing was aborted"): DOMException {
  if (typeof DOMException !== "undefined") {
    return new DOMException(message, "AbortError");
  }
  const err = new Error(message);
  (err as { name?: string }).name = "AbortError";
  return err as unknown as DOMException;
}

/**
 * 在循环顶部调用的协作式中断检查点。
 * 若 signal 已 abort，立即抛出 AbortError 终止后续解析；否则空操作。
 *
 * 设计为内联轻量检查，避免对热路径造成显著开销。
 */
function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}

// ──────────────────────────────────────────────────────────────────────────────
// 命令提取
// ──────────────────────────────────────────────────────────────────────────────

/**
 * 从文本中提取标准 MVU 命令（_.set/add/delete/remove/unset/assign/insert/move 格式）
 *
 * 示例输入：
 *   _.set("hp", 80); // 角色受伤
 *   _.add("gold", -50); // 消费金币
 */
export function extractMvuCommands(text: string, signal?: AbortSignal): { type: string; args: any[]; reason?: string }[] {
  const results: { type: string; args: any[]; reason?: string }[] = [];
  if (!text) return results;

  let i = 0;
  while (i < text.length) {
    checkAborted(signal);
    const match = text.substring(i).match(/_\.(set|add|delete|remove|unset|assign|insert|move)\(/);
    if (!match || match.index === undefined) break;

    const commandType = match[1];
    const startIdx = i + match.index;
    const openParen = startIdx + match[0].length;

    let parenCount = 1;
    let inQuote = false;
    let quoteChar = "";
    let closeParen = -1;
    for (let j = openParen; j < text.length; j++) {
      const char = text[j];
      const prevChar = j > 0 ? text[j - 1] : "";
      if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
        if (!inQuote) {
          inQuote = true;
          quoteChar = char;
        } else if (char === quoteChar) {
          inQuote = false;
        }
      }
      if (!inQuote) {
        if (char === '(') parenCount++;
        else if (char === ')') {
          parenCount--;
          if (parenCount === 0) {
            closeParen = j;
            break;
          }
        }
      }
    }

    if (closeParen === -1) {
      i = openParen;
      continue;
    }

    const paramsStr = text.substring(openParen, closeParen);
    const args = parseParamsString(paramsStr);

    let endPos = closeParen + 1;
    if (endPos < text.length && text[endPos] === ';') {
      endPos++;
    }
    let reason = "";
    const commentMatch = text.substring(endPos).match(/^\s*\/\/(.*)/);
    if (commentMatch) {
      reason = commentMatch[1].trim();
      endPos += commentMatch[0].length;
    }

    results.push({
      type: commandType,
      args,
      reason,
    });

    i = endPos;
  }

  return results;
}

// ──────────────────────────────────────────────────────────────────────────────
// 参数解析
// ──────────────────────────────────────────────────────────────────────────────

/** 解析逗号分隔的参数列表，支持嵌套括号、引号、数组/对象字面量 */
function parseParamsString(paramsStr: string): any[] {
  const params: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";
  let parenCount = 0;
  let bracketCount = 0;
  let braceCount = 0;

  for (let i = 0; i < paramsStr.length; i++) {
    const char = paramsStr[i];
    const prevChar = i > 0 ? paramsStr[i - 1] : "";

    if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
      if (!inQuote) {
        inQuote = true;
        quoteChar = char;
      } else if (char === quoteChar) {
        inQuote = false;
      }
    }

    if (!inQuote) {
      if (char === '(') parenCount++;
      else if (char === ')') parenCount--;
      else if (char === '[') bracketCount++;
      else if (char === ']') bracketCount--;
      else if (char === '{') braceCount++;
      else if (char === '}') braceCount--;
    }

    if (char === ',' && !inQuote && parenCount === 0 && bracketCount === 0 && braceCount === 0) {
      params.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    params.push(current.trim());
  }

  return params.map(p => parseParamValue(p));
}

/** 将单个参数字符串解析为对应的 JS 值（布尔、数字、字符串、JSON 等） */
function parseParamValue(p: string): any {
  p = p.trim();
  if (p === "true") return true;
  if (p === "false") return false;
  if (p === "null") return null;
  if (p === "undefined") return undefined;

  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'")) || (p.startsWith("`") && p.endsWith("`"))) {
    return p.slice(1, -1);
  }

  if (/^-?\d+(\.\d+)?$/.test(p)) {
    return Number(p);
  }

  if ((p.startsWith("[") && p.endsWith("]")) || (p.startsWith("{") && p.endsWith("}"))) {
    try {
      return JSON5.parse(p);
    } catch {
      return p;
    }
  }

  return p;
}

// ──────────────────────────────────────────────────────────────────────────────
// 命令应用
// ──────────────────────────────────────────────────────────────────────────────

/** 将单条 MVU 命令应用到 stat_data 上 */
function applyMvuCommand(statData: any, command: { type: string; args: any[]; reason?: string }) {
  if (!statData || !command.args || command.args.length === 0) return;

  let path = String(command.args[0]).trim();
  if (path.startsWith('"') || path.startsWith("'") || path.startsWith("`")) {
    path = path.slice(1, -1);
  }
  path = path.replace(/^(?:stat_data|status_current_variables)\./, '');

  const normalizedPath = path
    .replace(/\[['"`](.*?)['"`]\]/g, '.$1')
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/^\.+/, '');

  switch (command.type) {
    case 'set': {
      const newValue = command.args.length >= 2 ? command.args[command.args.length - 1] : undefined;
      const current = lodashGet(statData, normalizedPath);
      if (Array.isArray(current) && current.length === 2 && typeof current[1] === 'string') {
        current[0] = newValue;
        lodashSet(statData, normalizedPath, current);
      } else {
        lodashSet(statData, normalizedPath, newValue);
      }
      break;
    }
    case 'add': {
      const delta = command.args.length >= 2 ? Number(command.args[1]) : 0;
      const current = lodashGet(statData, normalizedPath);
      if (Array.isArray(current) && current.length === 2 && typeof current[1] === 'string') {
        const num = Number(current[0]) || 0;
        current[0] = num + delta;
        lodashSet(statData, normalizedPath, current);
      } else {
        const num = Number(current) || 0;
        lodashSet(statData, normalizedPath, num + delta);
      }
      break;
    }
    case 'delete':
    case 'remove':
    case 'unset': {
      if (command.args.length === 1) {
        lodashUnset(statData, normalizedPath);
      } else {
        const target = lodashGet(statData, normalizedPath);
        const keyOrIdx = command.args[1];
        if (Array.isArray(target)) {
          const idx = Number(keyOrIdx);
          if (!isNaN(idx)) {
            target.splice(idx, 1);
          }
        } else if (target && typeof target === 'object') {
          delete target[keyOrIdx];
        }
      }
      break;
    }
    case 'assign':
    case 'insert': {
      const target = lodashGet(statData, normalizedPath);
      if (command.args.length === 2) {
        const val = command.args[1];
        if (Array.isArray(target)) {
          target.push(val);
        } else {
          lodashSet(statData, normalizedPath, val);
        }
      } else if (command.args.length >= 3) {
        const keyOrIdx = command.args[1];
        const val = command.args[2];
        if (Array.isArray(target)) {
          const idx = Number(keyOrIdx);
          if (!isNaN(idx)) {
            target.splice(idx, 0, val);
          } else {
            target.push(val);
          }
        } else if (target && typeof target === 'object') {
          target[keyOrIdx] = val;
        } else {
          lodashSet(statData, `${normalizedPath}.${keyOrIdx}`, val);
        }
      }
      break;
    }
    case 'move': {
      if (command.args.length >= 2) {
        const fromPath = normalizedPath;
        let toPath = String(command.args[1]).trim();
        if (toPath.startsWith('"') || toPath.startsWith("'") || toPath.startsWith("`")) {
          toPath = toPath.slice(1, -1);
        }
        toPath = toPath.replace(/^(?:stat_data|status_current_variables)\./, '');
        const normalizedToPath = toPath
          .replace(/\[['"`](.*?)['"`]\]/g, '.$1')
          .replace(/\[(\d+)\]/g, '.$1')
          .replace(/^\.+/, '');

        const val = lodashGet(statData, fromPath);
        lodashUnset(statData, fromPath);
        lodashSet(statData, normalizedToPath, val);
      }
      break;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// XML 标签兼容（SillyTavern 方言）
// ──────────────────────────────────────────────────────────────────────────────

/**
 * 从 XML 标签中提取 MVU 命令（兼容 SillyTavern <UpdateVariable> / <initvar> 方言）
 *
 * 遵循 AGENTS.md 准则一.3（外部接口防腐隔离）：
 * 对外部卡片格式进行清洗后再进入核心解析管道。
 */
export function extractXmlMvuCommands(text: string, signal?: AbortSignal): { type: string; args: any[]; reason?: string }[] {
  const results: { type: string; args: any[]; reason?: string }[] = [];
  if (!text) return results;

  // 匹配 <UpdateVariable>...</UpdateVariable> 中的 MVU 命令
  const uvRegex = /<UpdateVariable\b[^>]*>([\s\S]*?)<\/UpdateVariable>/gi;
  let m;
  while ((m = uvRegex.exec(text)) !== null) {
    checkAborted(signal);
    const inner = m[1].trim();
    if (inner) {
      results.push(...extractMvuCommands(inner, signal));
    }
  }

  // 匹配 <initvar>...</initvar> 中的初始化命令
  const ivRegex = /<initvar\b[^>]*>([\s\S]*?)<\/initvar>/gi;
  while ((m = ivRegex.exec(text)) !== null) {
    checkAborted(signal);
    const inner = m[1].trim();
    if (inner) {
      // initvar 内容可能是 _.set() 命令 或 JSON Patch 数组
      if (inner.startsWith('[')) {
        // JSON Patch 格式，交由 parseMvuMessage 的 JSON Patch 分支处理
        // 这里不重复解析，避免双重执行
      } else {
        results.push(...extractMvuCommands(inner, signal));
      }
    }
  }

  return results;
}

// ──────────────────────────────────────────────────────────────────────────────
// JSON Patch (RFC 6902)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * 检测文本中是否包含 JSON Patch 格式（RFC 6902）的变量更新指令
 */
export function detectJsonPatch(text: string, signal?: AbortSignal): any[] | null {
  if (!text) return null;
  const patches: any[] = [];

  const tryParsePatch = (str: string) => {
    const trimmed = str.trim();
    if (!trimmed) return;
    try {
      const parsed = JSON5.parse(trimmed);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.op) {
        patches.push(...parsed);
      }
    } catch {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.op) {
          patches.push(...parsed);
        }
      } catch {}
    }
  };

  // 1. 优先尝试从 <JSONPatch>...</JSONPatch> 标签中提取
  const jsonPatchTagRegex = /<JSONPatch\b[^>]*>([\s\S]*?)<\/JSONPatch>/gi;
  let jpMatch;
  while ((jpMatch = jsonPatchTagRegex.exec(text)) !== null) {
    checkAborted(signal);
    tryParsePatch(jpMatch[1]);
  }

  // 2. 从 <UpdateVariable> 或 <initvar> 标签中提取（处理包含 <Analysis> 或裸 JSON 数组的情况）
  if (patches.length === 0) {
    const tagRegex = /<(?:UpdateVariable|initvar)\b[^>]*>([\s\S]*?)<\/(?:UpdateVariable|initvar)>/gi;
    let m;
    while ((m = tagRegex.exec(text)) !== null) {
      checkAborted(signal);
      const inner = m[1].trim();
      if (inner.includes("<JSONPatch>")) continue;

      if (inner.startsWith("[")) {
        tryParsePatch(inner);
      } else {
        const arrayMatch = inner.match(/\[\s*\{\s*["']op["']\s*:[\s\S]*?\]/);
        if (arrayMatch) {
          tryParsePatch(arrayMatch[0]);
        }
      }
    }
  }

  // 3. 检测裸 JSON Patch 数组（不在 XML 标签内）
  // 使用宽松正则做候选匹配（含 "op" 键的 JSON 数组），候选者由 tryParsePatch
  // 进一步校验（JSON5.parse → parsed[0]?.op），假阳性由 applyJsonPatchOperations
  // 在 switch 各分支内安全处理（无 path 则 break）。不再提前 return，确保
  // 步骤 2/3/4 的标准 MVU 命令与 XML 标签命令不会因假阳性被丢弃。
  if (patches.length === 0) {
    const bareMatch = text.match(/\[\s*\{\s*["']op["']\s*:[\s\S]*?\]/);
    if (bareMatch) {
      tryParsePatch(bareMatch[0]);
    }
  }

  return patches.length > 0 ? patches : null;
}

/**
 * 应用 JSON Patch (RFC 6902) 操作到 stat_data
 *
 * 支持 op: add, replace, remove, move, copy
 * path 格式：/foo/bar/0 → foo.bar.0（兼容 lodash 路径语法）
 */
function applyJsonPatchOperations(statData: any, patches: any[]): void {
  for (const patch of patches) {
    if (!patch || typeof patch !== 'object' || !patch.op) continue;

    const normalizePath = (p: string): string =>
      p.replace(/^\//, '').replace(/\//g, '.');

    switch (patch.op) {
      case 'add':
      case 'replace': {
        if (patch.path === undefined) break;
        const path = normalizePath(String(patch.path));
        if (path) {
          lodashSet(statData, path, patch.value);
        }
        break;
      }
      case 'remove': {
        if (patch.path === undefined) break;
        const path = normalizePath(String(patch.path));
        if (path) {
          lodashUnset(statData, path);
        }
        break;
      }
      case 'move': {
        if (patch.from === undefined || patch.path === undefined) break;
        const fromPath = normalizePath(String(patch.from));
        const toPath = normalizePath(String(patch.path));
        const val = lodashGet(statData, fromPath);
        lodashUnset(statData, fromPath);
        if (toPath) {
          lodashSet(statData, toPath, val);
        }
        break;
      }
      case 'copy': {
        if (patch.from === undefined || patch.path === undefined) break;
        const fromPath = normalizePath(String(patch.from));
        const toPath = normalizePath(String(patch.path));
        const val = lodashGet(statData, fromPath);
        if (toPath) {
          lodashSet(statData, toPath, lodashCloneDeep(val));
        }
        break;
      }
      // 'test' 操作不做处理，静默忽略（MVU 卡片极少使用）
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 统一入口
// ──────────────────────────────────────────────────────────────────────────────

/**
 * 极简的嵌套缩进式 YAML 解析器。
 * 支持解析多层级缩进对象、一维数组，以及基础的数据类型（布尔值、数字、字符串）。
 */
export function parseNestedYaml(str: string): Record<string, any> {
  const root: Record<string, any> = {};
  const stack: { indent: number; obj: Record<string, any> }[] = [{ indent: -1, obj: root }];
  
  const lines = str.split(/\r?\n/);
  for (const line of lines) {
    // 忽略空行和注释
    if (!line.trim() || line.trim().startsWith("#")) continue;
    
    // 计算缩进层级（前导空格数）
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    
    const key = trimmed.slice(0, colonIdx).trim().replace(/^["']|["']$/g, "");
    let val: any = trimmed.slice(colonIdx + 1).trim();
    
    // 解析基础类型
    if (val !== "") {
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      } else if (val === "true") {
        val = true;
      } else if (val === "false") {
        val = false;
      } else if (val === "null" || val === "~") {
        val = null;
      } else if (/^-?\d+(\.\d+)?$/.test(val)) {
        val = Number(val);
      }
    }
    
    // 根据缩进层级在栈中寻找父级容器
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    
    const parent = stack[stack.length - 1].obj;
    if (val === "") {
      const child = {};
      parent[key] = child;
      stack.push({ indent, obj: child });
    } else {
      parent[key] = val;
    }
  }
  return root;
}

/**
 * 递归的深度对象合并方法。
 */
export function deepMerge(target: any, source: any): any {
  if (!target || !source || typeof target !== "object" || typeof source !== "object") {
    return target;
  }
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      if (!target[key] || typeof target[key] !== "object") {
        target[key] = {};
      }
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

/**
 * 解析 MVU 消息并返回更新后的变量快照（深拷贝，不污染原始输入）
 *
 * 处理顺序：
 * 1. JSON Patch (RFC 6902) 格式 — 最高优先级
 * 2. 标准 MVU 命令（_.set/add/delete/remove/unset/assign/insert/move 格式）
 * 3. XML 标签内的 MVU 命令（<UpdateVariable> / <initvar> 兼容）
 * 4. XML 标签中的 YAML 内容并合并到 statData
 */
export function parseMvuMessage(message: string, oldData: any, signal?: AbortSignal): any {
  if (!oldData) return oldData;
  const newData = lodashCloneDeep(oldData);
  const statData = newData.stat_data || newData;

  // 1. 尝试 JSON Patch (RFC 6902) 格式
  // 注意：不提前 return！某些 AI 回复可能同时包含 JSON Patch 与标准 MVU 命令
  // （_.set / _.add 等）或 XML 标签命令。提前 return 会导致后两类命令被静默丢弃。
  const jsonPatches = detectJsonPatch(message, signal);
  if (jsonPatches) {
    applyJsonPatchOperations(statData, jsonPatches);
  }

  // 2. 提取标准 MVU 命令（_.set/add/delete/remove/unset/assign/insert/move 格式）
  const commands = extractMvuCommands(message, signal);
  for (const cmd of commands) {
    checkAborted(signal);
    applyMvuCommand(statData, cmd);
  }

  // 3. 提取 XML 标签内的 MVU 命令（<UpdateVariable> / <initvar> 兼容）
  const xmlCommands = extractXmlMvuCommands(message, signal);
  for (const cmd of xmlCommands) {
    checkAborted(signal);
    applyMvuCommand(statData, cmd);
  }

  // 4. 提取 XML 标签中的 YAML 内容并合并到 statData
  const tagRegex = /<(?:UpdateVariable|initvar)\b[^>]*>([\s\S]*?)<\/(?:UpdateVariable|initvar)>/gi;
  let m;
  while ((m = tagRegex.exec(message)) !== null) {
    checkAborted(signal);
    const inner = m[1].trim();
    // 排除 JSON Patch（以 [ 开头）与标准 MVU 命令（包含 _.）
    if (inner && !inner.startsWith("[") && !inner.includes("_.")) {
      try {
        const parsedYaml = parseNestedYaml(inner);
        if (parsedYaml && typeof parsedYaml === "object" && Object.keys(parsedYaml).length > 0) {
          const source = (parsedYaml.stat_data && typeof parsedYaml.stat_data === "object")
            ? parsedYaml.stat_data
            : parsedYaml;
          deepMerge(statData, source);
        }
      } catch (err) {
        console.warn("[parseMvuMessage] Failed to parse XML YAML content:", err);
      }
    }
  }

  return newData;
}

export function applyCharacterRegexScripts(
  text: string,
  character: any,
  isAiMessage?: boolean,
  charName?: string,
  userName?: string,
  mode?: "render" | "prompt" | "store",
  signal?: AbortSignal
): string {
  if (!text || !character) return text;

  const ext = character.extensions || {};
  const rawCharScripts = ext.regex_scripts;
  const charRegexScripts = Array.isArray(rawCharScripts)
    ? rawCharScripts
    : (rawCharScripts && typeof rawCharScripts === "object" ? Object.values(rawCharScripts) : []);

  let processed = text;

  const finalCharName = charName || character.name || "";
  const finalUserName = userName || "user";

  console.log(`[applyCharacterRegexScripts] processing character: ${character.name}, text length: ${text.length}, scripts count: ${charRegexScripts.length}, isAiMessage: ${isAiMessage}, mode: ${mode || "default"}`);

  for (const script of charRegexScripts) {
    if (!script || script.disabled) continue;
    checkAborted(signal);
    // 按 mode 区分 markdownOnly / promptOnly 脚本的应用时机：
    // - render: 渲染时应用 markdownOnly + 无标记脚本，跳过 promptOnly
    // - prompt: 发送给AI时应用 promptOnly + 无标记脚本，跳过 markdownOnly
    // - store: 存储时只应用无标记脚本，跳过 markdownOnly 和 promptOnly（保存原始内容）
    // - 默认（无 mode）: 向后兼容，跳过 promptOnly，应用 markdownOnly + 无标记
    if (mode === "store") {
      if (script.promptOnly || script.markdownOnly) continue;
    } else if (mode === "prompt") {
      if (script.markdownOnly) continue;
    } else {
      if (script.promptOnly) continue;
    }
    
    const placement = script.placement;
    let isAllowedPlacement = true;
    if (placement !== undefined && placement !== null) {
      if (Array.isArray(placement)) {
        if (placement.length > 0) {
          const targetPlacement = isAiMessage === true ? 2 : (isAiMessage === false ? 1 : null);
          if (targetPlacement !== null) {
            if (!placement.includes(targetPlacement)) {
              isAllowedPlacement = false;
            }
          } else {
            if (!placement.includes(1) && !placement.includes(2)) {
              isAllowedPlacement = false;
            }
          }
        }
      } else if (typeof placement === "number") {
        const targetPlacement = isAiMessage === true ? 2 : (isAiMessage === false ? 1 : null);
        if (targetPlacement !== null) {
          if (placement !== targetPlacement) {
            isAllowedPlacement = false;
          }
        } else {
          if (placement !== 1 && placement !== 2) {
            isAllowedPlacement = false;
          }
        }
      }
    }
    if (!isAllowedPlacement) {
      continue;
    }
    
    let findRegexStr = script.findRegex;
    const replaceString = script.replaceString || "";
    if (!findRegexStr) continue;
    
    // 关键功能实现：支持 SillyTavern 标准的 "Substitute (raw)" 宏替换功能。
    findRegexStr = findRegexStr
      .replace(/\{\{char\}\}/gi, finalCharName)
      .replace(/<BOT>/gi, finalCharName)
      .replace(/\{\{user\}\}/gi, finalUserName)
      .replace(/<USER>/gi, finalUserName);
      
    try {
      let regex: RegExp;
      const match = findRegexStr.match(/^\/(.*)\/([gimsuy]*)$/);
      if (match) {
        regex = new RegExp(match[1], match[2]);
      } else {
        regex = new RegExp(findRegexStr, "gi");
      }
      
      const beforeLen = processed.length;
      processed = processed.replace(regex, replaceString);
      const afterLen = processed.length;
      
      if (beforeLen !== afterLen) {
        console.log(`[applyCharacterRegexScripts] script: "${script.scriptName}", replaced! beforeLen: ${beforeLen}, afterLen: ${afterLen}`);
      }
    } catch (err) {
      console.warn("[applyCharacterRegexScripts] Failed to apply regex:", findRegexStr, err);
    }
  }
  
  return processed;
}
