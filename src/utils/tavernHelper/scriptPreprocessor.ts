/**
 * scriptPreprocessor.ts — MVU 脚本预处理与懒求值缓存
 *
 * 职责：
 * - 对 MVU 框架脚本（mvu.js / mvu_zod.js / mvu_bundle.js）做 CDN 替换，生成离线可执行 IIFE
 * - preprocessScriptContent：对用户角色卡脚本中的 ESM CDN 导入做本地化替换
 *
 * 从 scriptIframe.ts 拆出，遵循 AGENTS.md 准则一.6（单文件职责边界拆分）。
 * 依赖 Vite 的 ?raw 语法读取脚本文件内容，仅在 Vite 构建环境下可用。
 */

import mvuBundleContent from "../mvu_bundle.js?raw";
import mvuZodContent from "../mvu_zod.js?raw";
import mvuContent from "../mvu.js?raw";
import { replaceEsmImports, MVU_LIB_MAP } from "./esmReplacer";

// ──────────────────────────────────────────────────────────────────────────────
// 预处理懒求值：首次调用才计算，之后缓存。
// 避免模块导入时立即处理 ~39KB bundle 内容，
// 对不使用脚本的纯对话卡无负担。
// ──────────────────────────────────────────────────────────────────────────────

let _processedMvuZod: string | null = null;
let _processedMvu: string | null = null;
let _processedMvuBundle: string | null = null;

/** 预处理 mvu_zod 脚本：移除 ES 模块 export 声明并包裹为 IIFE（懒求值） */
export function getProcessedMvuZod(): string {
  if (_processedMvuZod !== null) return _processedMvuZod;
  _processedMvuZod = `(function(){\n  ${mvuZodContent
    .replace(/export\s*\{\s*s\s*as\s*registerMvuSchema\s*\};?/g, "")
    .replace(/\/\/#\s*sourceMappingURL=.*/g, "")}\n})();`;
  return _processedMvuZod;
}

/** 预处理 mvu 脚本：泛化替换 pinia CDN import 后包裹为 IIFE（懒求值） */
export function getProcessedMvu(): string {
  if (_processedMvu !== null) return _processedMvu;
  _processedMvu = `(function(){\n  ${replaceEsmImports(mvuContent, { "pinia": { type: "named", libKey: null } })
    .replace(/\bexport\s*\{\s*(\w+)\s+as\s+defineMvuDataStore\s*\};?/g, (_m, local) =>
      `window.defineMvuDataStore = ${local};`
    )}\n})();`;
  return _processedMvu;
}

/** 预处理 mvu_bundle 脚本：泛化替换所有 CDN import 后包裹为 IIFE（懒求值） */
export function getProcessedMvuBundle(): string {
  if (_processedMvuBundle !== null) return _processedMvuBundle;
  _processedMvuBundle = `(function(){\n  ${replaceEsmImports(
    mvuBundleContent.replace(/\/\/#\s*sourceMappingURL=.*/g, ""),
    MVU_LIB_MAP
  )}\n})();`;
  return _processedMvuBundle;
}

// ──────────────────────────────────────────────────────────────────────────────
// 脚本内容预处理：将角色卡脚本中的 CDN 导入替换为本地查找
// ──────────────────────────────────────────────────────────────────────────────

/**
 * 循环看门狗拦截注入器 (Loop Protection)
 *
 * 对脚本源码中的 for, while, do-while 循环进行分析。
 * 如果检测到执行总耗时超过 1000ms，抛出 Error 中断，防止锁死事件循环。
 */
export function injectLoopProtection(code: string): string {
  const randPrefix = Math.random().toString(36).substring(2, 9);
  let loopCounter = 0;

  const helperCode = `
    if (typeof window !== 'undefined' && !window.__check_loop) {
      window.__loop_guards = {};
      window.__check_loop = function(id) {
        if (!window.__loop_guards[id]) {
          window.__loop_guards[id] = Date.now();
        } else if (Date.now() - window.__loop_guards[id] > 1000) {
          throw new Error("[Infinite Loop Protection] Loop execution exceeded 1000ms timeout. Terminated.");
        }
      };
      window.__reset_loop = function(id) {
        if (window.__loop_guards) {
          delete window.__loop_guards[id];
        }
      };
    }
  `;

  // 掩码屏蔽注释与字符串字面量，防止误匹配
  const literals: string[] = [];
  let masked = code
    // 屏蔽块注释
    .replace(/\/\*[\s\S]*?\*\//g, (m) => {
      literals.push(m);
      return `__LITERAL_${literals.length - 1}__`;
    })
    // 屏蔽行注释
    .replace(/\/\/[^\n]*/g, (m) => {
      literals.push(m);
      return `__LITERAL_${literals.length - 1}__`;
    })
    // 屏蔽字符串 (支持单双引号及多行模板字符串)
    .replace(/(["'`])(?:\\.|[^\\])*?\1/g, (m) => {
      literals.push(m);
      return `__LITERAL_${literals.length - 1}__`;
    });

  // 开始扫描并匹配 for/while ( ... ) {
  const loopRegex = /\b(for|while)\b/g;
  let match;
  let result = "";
  let lastIndex = 0;

  while ((match = loopRegex.exec(masked)) !== null) {
    const loopType = match[1];
    const startIndex = match.index;

    // 关键字后面必须是 '(' 括号
    const remainder = masked.substring(startIndex + loopType.length);
    const trimStartSpace = remainder.match(/^\s*/);
    const spaceOffset = trimStartSpace ? trimStartSpace[0].length : 0;
    const nextCharIndex = startIndex + loopType.length + spaceOffset;

    if (masked[nextCharIndex] !== "(") {
      continue;
    }

    // 匹配括号对
    let parenCount = 1;
    let endParenIndex = -1;
    for (let j = nextCharIndex + 1; j < masked.length; j++) {
      if (masked[j] === "(") parenCount++;
      else if (masked[j] === ")") {
        parenCount--;
        if (parenCount === 0) {
          endParenIndex = j;
          break;
        }
      }
    }

    if (endParenIndex === -1) continue;

    // 括号后必须跟有 '{' 大括号
    const afterParen = masked.substring(endParenIndex + 1);
    const trimStartBraceSpace = afterParen.match(/^\s*/);
    const braceSpaceOffset = trimStartBraceSpace ? trimStartBraceSpace[0].length : 0;
    const nextBraceIndex = endParenIndex + 1 + braceSpaceOffset;

    if (masked[nextBraceIndex] !== "{") {
      continue;
    }

    // 找到匹配的 '{'
    loopCounter++;
    const loopId = `L_${randPrefix}_${loopCounter}`;

    result += masked.substring(lastIndex, startIndex);
    result += `window.__reset_loop("${loopId}");\n`;
    result += masked.substring(startIndex, nextBraceIndex + 1);
    result += `\n  window.__check_loop("${loopId}");`;

    lastIndex = nextBraceIndex + 1;
    loopRegex.lastIndex = lastIndex;
  }

  result += masked.substring(lastIndex);

  // 加固 'do {' 循环
  result = result.replace(/\bdo\s*\{/g, () => {
    loopCounter++;
    const loopId = `L_${randPrefix}_do_${loopCounter}`;
    return `window.__reset_loop("${loopId}");\ndo {\n  window.__check_loop("${loopId}");`;
  });

  // 还原注释与字符串
  for (let r = literals.length - 1; r >= 0; r--) {
    const rawVal = literals[r];
    const marker = `__LITERAL_${r}__`;
    result = result.split(marker).join(rawVal);
  }

  return helperCode + "\n" + result;
}

export function preprocessScriptContent(content: string, enableLoopProtection = true): string {
  let processed = content;

  // 1. 移除 MVU bundle 的 side-effect import
  processed = processed.replace(
    /import\s*['"][^'"]*bundle(?:\.js)?['"];?/g,
    `// 本地 MVU bundle 已预加载`
  );

  // 2. 替换 mvu_zod 的具名导入为 window.registerMvuSchema
  processed = processed.replace(
    /import\s*\{[^}]*registerMvuSchema[^}]*\}\s*from\s*['"][^'"]*mvu_zod[^'"]*['"];?/g,
    `const registerMvuSchema = window.registerMvuSchema;`
  );

  // 3. 替换 mvu 框架导入
  processed = processed.replace(
    /import\s*\{([^}]+)\}\s*from\s*['"](?:https?:\/\/(?:testingcf\.)?jsdelivr\.net\/npm\/mvu(?:\.js)?\/\+esm|[^'"]*mvu(?:\.js)?)['"];?/g,
    (_match, importsStr: string) => {
      const parts = importsStr.split(",").map((p: string) => {
        const item = p.trim();
        const asMatch = item.match(/^(\S+)\s+as\s+(\S+)$/);
        if (asMatch) {
          const [, orig, alias] = asMatch;
          if (orig === "default" || orig === "defineMvuDataStore") {
            return `defineMvuDataStore: ${alias}`;
          }
          return `${orig}: ${alias}`;
        }
        return item;
      });
      return `const { ${parts.join(", ")} } = { defineMvuDataStore: window.defineMvuDataStore };`;
    }
  );

  // 4. 泛化替换 jsdelivr CDN 上的所有 named / namespace import
  processed = replaceEsmImports(processed, MVU_LIB_MAP);

  // 5. 清理 ES 模块 export 声明
  processed = processed.replace(/\bexport\s+(const|let|var|function|class)\b/g, "$1");
  processed = processed.replace(/\bexport\s*\{[^}]*\};?/g, "");
  processed = processed.replace(/\bexport\s+default\b/g, "");

  // 6. 自动织入循环安全看门狗（若开启）
  if (enableLoopProtection) {
    processed = injectLoopProtection(processed);
  }

  return processed;
}
