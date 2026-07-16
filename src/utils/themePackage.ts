/**
 * themePackage.ts — 自定义主题包导入导出核心沙盒
 *
 * 职责：
 *   1. 定义 `.tavern-theme.json` 包格式（CustomThemePackage）
 *   2. CSS 变量白名单校验（禁止 --safe-area-* / --android-safe-area-*）
 *   3. 包序列化/反序列化（JSON）
 *   4. CSS 注入到 document.head（动态 <style> 标签）
 *   5. 包名 → 主题 id 生成（`custom_<sanitized>_<shortHash>`）
 *
 * 遵循 AGENTS.md 准则八（AI 协作物理隔离开发铁律）：
 *   - 单文件读写，不依赖 React/UI
 *   - 纯函数 + 显式 document 注入，可单兵测试
 *
 * 安全约束（复用 sanitizeCss 思路）：
 *   - 仅放行白名单 CSS 变量名
 *   - customCss 经 sanitizeCss 过滤后注入
 *   - 禁止任何包含 `<`/`>`/`</style>` 的值通过
 */

import { sanitizeCss } from "./security";

// ===== 常量 =====

/**
 * 允许用户在主题包中定义的 CSS 变量白名单。
 * 安全区相关变量（--safe-area-* / --android-safe-area-*）严禁开放，
 * 否则用户可能破坏移动端状态栏/手势条避让，导致 UI 被原生层遮挡。
 */
export const ALLOWED_CSS_VARS: ReadonlySet<string> = new Set([
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--destructive-foreground",
  "--border",
  "--input",
  "--ring",
  "--radius",
  "--dialogue-color",
  "--prose-color",
]);

/** 禁止的变量名前缀（安全区相关） */
const FORBIDDEN_VAR_PREFIXES = ["--safe-area", "--android-safe-area"];

/** 主题 id 在 document 中的前缀，避免与内置 snow/sand/ocean/obsidian 冲突 */
export const CUSTOM_THEME_ID_PREFIX = "custom_";

/** 动态注入 <style> 标签的 id 前缀 */
const STYLE_TAG_ID_PREFIX = "tavern-custom-theme-";

/** 包名最大长度 */
const MAX_NAME_LENGTH = 40;

// ===== 类型 =====

/**
 * 自定义主题包结构。
 * 对应 `.tavern-theme.json` 文件格式。
 */
export interface CustomThemePackage {
  /** 包格式版本，当前固定为 "1.0" */
  schemaVersion: "1.0";
  /** 主题显示名（用户可读） */
  name: string;
  /** 主题版本号（语义化版本，如 "1.0.0"） */
  version: string;
  /** 主题描述（可选） */
  description?: string;
  /** 是否为暗色主题（影响 colorScheme 与状态栏配色） */
  isDark: boolean;
  /**
   * CSS 变量键值对。
   * 键必须在 ALLOWED_CSS_VARS 白名单内。
   * 值为任意合法 CSS（颜色/长度等），经 sanitizeCss 二次过滤后注入。
   */
  variables: Record<string, string>;
  /**
   * 可选的额外 CSS 片段，附加在变量声明之后。
   * 经 sanitizeCss 过滤，禁止 @import / url() / expression() / position:fixed / <script>。
   */
  customCss?: string;
  /** 导入时由系统生成的唯一 id（导出时为空，导入时填充） */
  id?: string;
  /** 创建时间戳（导入时填充） */
  importedAt?: number;
}

/** 校验结果 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  /** 规范化后的包（移除非法字段，修剪字符串） */
  sanitized?: CustomThemePackage;
}

// ===== 校验 =====

/**
 * 校验主题包结构。
 *
 * 校验项：
 *   1. 顶层字段齐全（schemaVersion / name / version / isDark / variables）
 *   2. schemaVersion 必须为 "1.0"
 *   3. name 非空且 ≤ 40 字符
 *   4. version 非空
 *   5. variables 的键必须在 ALLOWED_CSS_VARS 白名单内
 *   6. variables 的值不能包含 </style> / <script
 *   7. customCss 经 sanitizeCss 处理
 *
 * @param raw 任意对象（通常是 JSON.parse 的结果）
 * @returns 校验结果，valid 为 true 时 sanitized 字段携带规范化后的包
 */
export function validateThemePackage(raw: unknown): ValidationResult {
  const errors: string[] = [];

  if (!raw || typeof raw !== "object") {
    return { valid: false, errors: ["主题包必须是 JSON 对象"] };
  }

  const pkg = raw as Record<string, unknown>;

  // 1. schemaVersion
  if (pkg.schemaVersion !== "1.0") {
    errors.push(`schemaVersion 必须为 "1.0"，当前为 ${JSON.stringify(pkg.schemaVersion)}`);
  }

  // 2. name
  const rawName = typeof pkg.name === "string" ? pkg.name.trim() : "";
  if (!rawName) {
    errors.push("name 不能为空");
  } else if (rawName.length > MAX_NAME_LENGTH) {
    errors.push(`name 长度不能超过 ${MAX_NAME_LENGTH} 字符（当前 ${rawName.length}）`);
  }

  // 3. version
  const rawVersion = typeof pkg.version === "string" ? pkg.version.trim() : "";
  if (!rawVersion) {
    errors.push("version 不能为空");
  }

  // 4. isDark
  if (typeof pkg.isDark !== "boolean") {
    errors.push("isDark 必须为布尔值");
  }

  // 5. variables
  const rawVariables = pkg.variables;
  if (!rawVariables || typeof rawVariables !== "object" || Array.isArray(rawVariables)) {
    errors.push("variables 必须是对象");
  }

  // 6. customCss（可选）
  if (pkg.customCss !== undefined && typeof pkg.customCss !== "string") {
    errors.push("customCss 必须是字符串");
  }

  // 7. description（可选）
  if (pkg.description !== undefined && typeof pkg.description !== "string") {
    errors.push("description 必须是字符串");
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // 深度校验 variables 键值
  const sanitizedVars: Record<string, string> = {};
  const varObj = rawVariables as Record<string, unknown>;
  for (const [key, value] of Object.entries(varObj)) {
    // 键校验
    if (!ALLOWED_CSS_VARS.has(key)) {
      // 检查是否触犯禁止前缀
      const isForbidden = FORBIDDEN_VAR_PREFIXES.some(prefix => key.startsWith(prefix));
      if (isForbidden) {
        errors.push(`变量 ${key} 禁止修改（安全区相关变量）`);
      } else {
        errors.push(`变量 ${key} 不在白名单内（仅允许标准 UI 变量）`);
      }
      continue;
    }

    // 值校验
    if (typeof value !== "string") {
      errors.push(`变量 ${key} 的值必须是字符串`);
      continue;
    }

    // 值内容安全检查（防止 </style> 逃逸注入）
    if (value.includes("</style>") || /<script/i.test(value)) {
      errors.push(`变量 ${key} 的值包含禁止字符（</style> 或 <script>）`);
      continue;
    }

    sanitizedVars[key] = value.trim();
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const sanitized: CustomThemePackage = {
    schemaVersion: "1.0",
    name: rawName,
    version: rawVersion,
    isDark: pkg.isDark as boolean,
    variables: sanitizedVars,
  };

  if (typeof pkg.description === "string") {
    sanitized.description = pkg.description.trim() || undefined;
  }

  if (typeof pkg.customCss === "string" && pkg.customCss.trim()) {
    // customCss 经 sanitizeCss 过滤后保留
    sanitized.customCss = sanitizeCss(pkg.customCss);
  }

  return { valid: true, errors: [], sanitized };
}

// ===== id 生成 =====

/**
 * 根据包名生成稳定的主题 id。
 * 格式：`custom_<sanitized_name>_<shortHash>`
 *
 * 同名包多次导入会得到相同 id，用于幂等去重。
 *
 * @param name 主题包名
 * @returns 形如 `custom_yinghua_a1b2c3` 的 id
 */
export function generateThemeId(name: string): string {
  // 取名前 12 字符，仅保留字母数字与下划线
  const sanitized = name
    .toLowerCase()
    .replace(/[^\w]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 12) || "theme";

  // 短哈希（FNV-1a 32-bit 的低 24 位）
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const hashStr = (hash >>> 0).toString(36).slice(0, 6).padStart(6, "0");

  return `${CUSTOM_THEME_ID_PREFIX}${sanitized}_${hashStr}`;
}

// ===== 序列化 / 反序列化 =====

/**
 * 序列化主题包为 JSON 字符串（用于导出）。
 * 移除 id / importedAt 等运行时字段，保持包文件纯净可分享。
 */
export function serializeThemePackage(pkg: CustomThemePackage): string {
  const exportable: CustomThemePackage = {
    schemaVersion: pkg.schemaVersion,
    name: pkg.name,
    version: pkg.version,
    isDark: pkg.isDark,
    variables: { ...pkg.variables },
  };
  if (pkg.description) exportable.description = pkg.description;
  if (pkg.customCss) exportable.customCss = pkg.customCss;
  return JSON.stringify(exportable, null, 2);
}

/**
 * 解析 JSON 字符串为主题包并校验。
 *
 * @param jsonStr JSON 字符串
 * @returns 校验结果，valid 为 true 时 sanitized 字段携带完整包（含生成 id 与 importedAt）
 */
export function parseThemePackage(jsonStr: string): ValidationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonStr);
  } catch (e) {
    return { valid: false, errors: [`JSON 解析失败：${(e as Error).message}`] };
  }

  const result = validateThemePackage(raw);
  if (!result.valid || !result.sanitized) {
    return result;
  }

  const pkg = result.sanitized;
  // 生成稳定 id（同名包幂等）
  pkg.id = generateThemeId(pkg.name);
  pkg.importedAt = Date.now();

  return { valid: true, errors: [], sanitized: pkg };
}

// ===== CSS 注入 =====

/**
 * 构造主题包对应的 CSS 文本。
 *
 * 结构：
 *   [data-theme="custom_xxx"] {
 *     --background: #fff;
 *     --primary: #...;
 *     ...白名单变量...
 *   }
 *   /* customCss（已 sanitize）* /
 *
 * @param pkg 主题包
 * @returns 完整 CSS 文本
 */
export function buildThemeCss(pkg: CustomThemePackage): string {
  const selector = `[data-theme="${pkg.id}"]`;
  const varDecls = Object.entries(pkg.variables)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join("\n");

  const customCss = pkg.customCss ? `\n${pkg.customCss}` : "";

  return `${selector} {\n${varDecls}\n}${customCss}`;
}

/**
 * 将主题包注入 document.head。
 * 同 id 重复注入会先移除旧 <style> 再注入新 <style>，保证幂等。
 *
 * @param pkg 主题包
 */
export function applyThemePackage(pkg: CustomThemePackage): void {
  if (typeof document === "undefined") return;
  if (!pkg.id) return;

  const styleId = `${STYLE_TAG_ID_PREFIX}${pkg.id}`;
  const existing = document.getElementById(styleId);
  if (existing) {
    existing.remove();
  }

  const style = document.createElement("style");
  style.id = styleId;
  style.setAttribute("data-tavern-theme", pkg.id);
  style.textContent = buildThemeCss(pkg);
  document.head.appendChild(style);
}

/**
 * 移除已注入的主题包 <style>。
 *
 * @param themeId 主题 id（含 custom_ 前缀）
 */
export function removeThemePackageStyle(themeId: string): void {
  if (typeof document === "undefined") return;
  const styleId = `${STYLE_TAG_ID_PREFIX}${themeId}`;
  const existing = document.getElementById(styleId);
  if (existing) {
    existing.remove();
  }
}

// ===== 辅助 =====

/**
 * 判断一个主题 id 是否为自定义主题。
 */
export function isCustomThemeId(themeId: string): boolean {
  return themeId.startsWith(CUSTOM_THEME_ID_PREFIX);
}

/**
 * 从内置主题名/自定义主题 id 中判断是否为暗色主题。
 *
 * @param themeId 主题 id
 * @param customThemes 已导入的自定义主题列表
 * @returns 是否为暗色主题
 */
export function isDarkTheme(
  themeId: string,
  customThemes: CustomThemePackage[]
): boolean {
  if (themeId === "ocean" || themeId === "obsidian") return true;
  if (themeId === "snow" || themeId === "sand") return false;
  // 自定义主题：从包元数据读取
  if (isCustomThemeId(themeId)) {
    const pkg = customThemes.find(t => t.id === themeId);
    return pkg?.isDark ?? false;
  }
  return false;
}
