/**
 * i18n 键一致性检查脚本
 *
 * 扫描 src/ 下所有 t("key") 调用，对比 8 个语言翻译文件，报告：
 * - 代码引用但翻译缺失的 key
 * - 某语言遗漏的 key
 * - 翻译定义了但代码未引用的死 key
 *
 * 用法：npx tsx scripts/check-i18n.ts
 */
import { readFileSync, readdirSync } from "fs";
import { resolve, relative, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SRC_DIR = resolve(__dirname, "../src");
const LOCALES_DIR = resolve(SRC_DIR, "locales");
const LANGUAGES = ["zh-CN", "zh-TW", "en", "ja", "ru", "es", "ko", "pt-BR"];

// ─── 提取翻译 key ────────────────────────────────────────────────────────────

/** 从 TypeScript 源码中提取所有 t("...") 调用中的 key */
function extractKeysFromFile(filePath: string): Map<string, string[]> {
  const content = readFileSync(filePath, "utf-8");
  const result = new Map<string, string[]>();

  // 匹配 t("任意内容")，支持花括号内的逗号（如 t("key", { count: "5" })）
  const regex = /[^a-zA-Z]t\(\s*["']([a-zA-Z0-9][a-zA-Z0-9._-]*)["']\s*[),]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const key = match[1];
    const existing = result.get(key);
    if (existing) {
      existing.push(filePath);
    } else {
      result.set(key, [filePath]);
    }
  }
  return result;
}

/** 递归收集目录下所有 .ts/.tsx 文件 */
function collectTsFiles(dir: string, exclude: string[] = []): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = resolve(dir, entry.name);
    if (exclude.some((e) => fullPath.includes(e))) continue;
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(fullPath, exclude));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }
  return files;
}

/** 从翻译文件中加载所有 key */
function loadLocaleKeys(lang: string): Set<string> {
  const filePath = resolve(LOCALES_DIR, `${lang}.ts`);
  const content = readFileSync(filePath, "utf-8");
  const keys = new Set<string>();

  // 匹配 "key": 或 "key" : 模式
  const regex = /^\s*"([a-zA-Z0-9][a-zA-Z0-9._-]*)"/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    keys.add(match[1]);
  }
  return keys;
}

// ─── 主逻辑 ───────────────────────────────────────────────────────────────────

const allSourceFiles = collectTsFiles(SRC_DIR, [LOCALES_DIR, resolve(SRC_DIR, "contexts/LanguageContext.tsx")]);
const codeKeys = new Map<string, string[]>();

for (const file of allSourceFiles) {
  for (const [key, paths] of extractKeysFromFile(file)) {
    const existing = codeKeys.get(key);
    if (existing) {
      existing.push(...paths);
    } else {
      codeKeys.set(key, [...paths]);
    }
  }
}

const localeKeysMap = new Map<string, Set<string>>();
for (const lang of LANGUAGES) {
  localeKeysMap.set(lang, loadLocaleKeys(lang));
}

// ─── 检查 ─────────────────────────────────────────────────────────────────────

let hasError = false;
const zhCNKeys = localeKeysMap.get("zh-CN")!;
const codeKeySet = new Set(codeKeys.keys());

// 1. 代码引用但 zh-CN 没有
const missingInZhCN = [...codeKeySet].filter((k) => !zhCNKeys.has(k));
if (missingInZhCN.length > 0) {
  hasError = true;
  console.log("✗ 代码引用但 zh-CN 定义缺失:\n");
  for (const key of missingInZhCN) {
    const files = codeKeys.get(key)!.map((f) => relative(SRC_DIR, f)).join(", ");
    console.log(`  ${key}  →  ${files}`);
  }
  console.log("");
}

// 2. 各语言对比 zh-CN
for (const lang of LANGUAGES.filter((l) => l !== "zh-CN")) {
  const langKeys = localeKeysMap.get(lang)!;
  const missing = [...zhCNKeys].filter((k) => !langKeys.has(k));

  if (missing.length > 0) {
    hasError = true;
    // 只显示前 5 个，避免刷屏
    const preview = missing.slice(0, 5).join(", ");
    const extra = missing.length > 5 ? ` ... 等 ${missing.length} 个` : "";
    console.log(`✗ zh-CN 有但 ${lang} 缺失 (${missing.length}): ${preview}${extra}`);
  }
}

// 3. 翻译定义但代码未引用
const deadKeys = [...zhCNKeys].filter((k) => !codeKeySet.has(k));
if (deadKeys.length > 0) {
  console.log(`⚠ 翻译定义但代码未引用 (${deadKeys.length}): ${deadKeys.slice(0, 5).join(", ")}...`);
}

// ─── 汇总 ─────────────────────────────────────────────────────────────────────

if (!hasError) {
  const allSynced = LANGUAGES.filter((l) => l !== "zh-CN").every(
    (l) => localeKeysMap.get(l)!.size === zhCNKeys.size
  );
  console.log(`✓ 所有检查通过`);
  console.log(`  代码引用: ${codeKeySet.size} 个 key`);
  console.log(`  翻译定义: ${zhCNKeys.size} 个 key/语言 × ${LANGUAGES.length} 语言`);
  if (allSynced) console.log(`  全部语言 key 数量一致`);
} else {
  process.exit(1);
}
