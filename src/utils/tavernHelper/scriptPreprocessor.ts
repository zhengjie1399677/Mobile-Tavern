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

export function preprocessScriptContent(content: string): string {
  let processed = content;

  // 1. 移除 MVU bundle 的 side-effect import（bundle 已在沙盒中预加载）
  processed = processed.replace(
    /import\s*['"][^'"]*bundle(?:\.js)?['"];?/g,
    `// 本地 MVU bundle 已预加载`
  );

  // 2. 替换 mvu_zod 的具名导入为 window.registerMvuSchema
  processed = processed.replace(
    /import\s*\{[^}]*registerMvuSchema[^}]*\}\s*from\s*['"][^'"]*mvu_zod[^'"]*['"];?/g,
    `const registerMvuSchema = window.registerMvuSchema;`
  );

  // 3. 替换 mvu 框架导入（CDN URL 与相对路径两种形式统一处理）
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

  // 5. 清理 ES 模块 export 声明（卡片脚本运行在同步沙盒中，不支持 export）
  processed = processed.replace(/\bexport\s+(const|let|var|function|class)\b/g, "$1");
  processed = processed.replace(/\bexport\s*\{[^}]*\};?/g, "");
  processed = processed.replace(/\bexport\s+default\b/g, "");

  return processed;
}
