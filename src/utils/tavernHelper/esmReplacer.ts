/**
 * esmReplacer.ts — 通用 ESM CDN import 替换器
 *
 * 职责：
 * - 对代码中的 jsdelivr CDN ESM import 语句做本地化替换
 * - 将 `import { X } from 'CDN_URL'` 转换为 `const { X } = window.parent.TavernHelperMvuLibs`
 * - 与具体 minified 变量名无关，bundle 重新构建后自动适配
 *
 * 从 scriptIframe.ts 拆出，遵循 AGENTS.md 准则一.6（单文件职责边界拆分）。
 */

/**
 * CDN 包配置描述符
 *
 * - type "named"     ：对应 `import { X as Y } from '...'` 形式
 * - type "namespace" ：对应 `import * as Z from '...'` 形式
 * - libKey            ：TavernHelperMvuLibs 上的属性名；为 null 时直接解构整个对象
 * - defaultAlias      ：`default as X` 时 default 对应的 libKey 名（如 "JSON5"）
 */
export interface CdnLibConfig {
  type: "named" | "namespace";
  libKey: string | null;
  defaultAlias?: string;
}

/**
 * 通用 ESM CDN import 替换器
 *
 * 对 code 中所有符合 jsdelivr CDN URL 格式的 ESM import 语句，
 * 根据 libMap 动态解析绑定关系并生成等价的 const 赋值语句。
 * 与具体 minified 变量名完全无关，bundle 重新构建后自动适配。
 *
 * 支持的 import 形式：
 *   - `import { X as localName, Y as localName2 } from 'CDN_URL'`
 *   - `import * as localName from 'CDN_URL'`
 *   - `import { default as localName } from 'CDN_URL'`（通过 defaultAlias 映射）
 */
export function replaceEsmImports(code: string, libMap: Record<string, CdnLibConfig>): string {
  // 匹配 CDN URL 中的包名（含 scope，如 @scope/pkg）
  const CDN_PKG_RE = /https?:\/\/(?:testingcf\.)?jsdelivr\.net\/npm\/([^/@][^/]*|@[^/]+\/[^/]+)(?:@[^/]+)?\/\+esm/;

  // 替换 `import * as Z from '...'`（namespace import）
  code = code.replace(
    /import\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g,
    (_match, localName: string, url: string) => {
      const pkgMatch = url.match(CDN_PKG_RE);
      if (!pkgMatch) return _match;
      const pkgName = pkgMatch[1];
      const cfg = libMap[pkgName];
      if (!cfg || cfg.type !== "namespace") return _match;
      const prop = cfg.libKey ?? pkgName;
      return `const ${localName} = window.parent.TavernHelperMvuLibs.${prop};`;
    }
  );

  // 替换 `import { X as Y, ... } from '...'`（named import）
  code = code.replace(
    /import\s*\{([^}]+)\}\s+from\s*['"]([^'"]+)['"]/g,
    (_match, bindingsStr: string, url: string) => {
      const pkgMatch = url.match(CDN_PKG_RE);
      if (!pkgMatch) return _match;
      const pkgName = pkgMatch[1];
      const cfg = libMap[pkgName];
      if (!cfg || cfg.type !== "named") return _match;

      // 解析每个绑定 "origName as localName" 或 "name"
      const bindings = bindingsStr.split(",").map((s) => s.trim()).filter(Boolean);
      const parts = bindings.map((binding) => {
        const asMatch = binding.match(/^(\S+)\s+as\s+(\S+)$/);
        if (asMatch) {
          const [, origName, localName] = asMatch;
          // `default as X` 需要映射到 defaultAlias 指定的 key
          if (origName === "default") {
            const alias = cfg.defaultAlias ?? pkgName;
            return `${alias}: ${localName}`;
          }
          return `${origName}: ${localName}`;
        }
        // 无别名，直接使用原名
        return binding;
      });

      // libKey 非 null：该包只暴露单一值（如 klona），直接取属性
      if (cfg.libKey) {
        const singleMatch = bindings[0]?.match(/^(?:\S+)\s+as\s+(\S+)$/);
        const localName = singleMatch?.[1];
        if (localName) {
          return `const ${localName} = window.parent.TavernHelperMvuLibs.${cfg.libKey};`;
        }
      }

      // 多导出或无 libKey：直接从 TavernHelperMvuLibs 解构
      return `const { ${parts.join(", ")} } = window.parent.TavernHelperMvuLibs;`;
    }
  );

  return code;
}

// MVU bundle / mvu / mvu_zod 共用的 libMap 配置
export const MVU_LIB_MAP: Record<string, CdnLibConfig> = {
  "klona":            { type: "named",     libKey: "klona"        },
  "pinia":            { type: "named",     libKey: null           },
  "compare-versions": { type: "named",     libKey: null           },
  "json5":            { type: "named",     libKey: null,  defaultAlias: "JSON5" },
  "jsonrepair":       { type: "named",     libKey: null           },
  "mathjs":           { type: "namespace", libKey: "math"         },
};
