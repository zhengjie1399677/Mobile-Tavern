import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { preparePresetBundleImport } from "../src/application/useCases/preparePresetBundleImport";
import { sillyTavernPromptPresetCodec } from "../src/infrastructure/compat/sillytavern";
import { DEFAULT_PROMPT_CONFIG } from "../src/hooks/settings/defaults";

interface SampleVerificationResult {
  file: string;
  bytes: number;
  kind: "preset" | "json-tool" | "invalid";
  level?: string;
  prompts?: number;
  enabledPrompts?: number;
  regex?: number;
  warnings?: number;
  warningCodes?: string;
  errors?: number;
  elapsedMs: number;
  reason?: string;
}

async function verifyPresetSample(filePath: string): Promise<SampleVerificationResult> {
  const absolutePath = resolve(filePath);
  const startedAt = performance.now();
  const metadata = await stat(absolutePath);
  try {
    const parsed: unknown = JSON.parse(await readFile(absolutePath, "utf8"));
    if (!isRecord(parsed) || !Array.isArray(parsed.prompts)) {
      return {
        file: basename(absolutePath),
        bytes: metadata.size,
        kind: "json-tool",
        elapsedMs: roundMs(startedAt),
        reason: "JSON 不包含 prompts 数组，不属于可直接导入的预设。",
      };
    }
    const prepared = preparePresetBundleImport({
      input: parsed,
      fallbackName: basename(absolutePath, ".json"),
      currentPromptConfig: DEFAULT_PROMPT_CONFIG,
      // 验收必须使用与运行时相同的 Compatibility Codec，否则只能得到"仅通用字段"的降级结果。
      compatibilityCodec: sillyTavernPromptPresetCodec,
    });
    return {
      file: basename(absolutePath),
      bytes: metadata.size,
      kind: "preset",
      // 编排链路已删除：验收只统计传统提示词列表（导入后的 `customPrompts`）。
      level: "legacy",
      prompts: prepared.bundle.promptConfig.customPrompts?.length ?? 0,
      enabledPrompts: prepared.bundle.promptConfig.customPrompts?.filter((item) => item.enabled).length,
      // v2 预设实体的正则字段是 `regexScripts`；此处历史上写成 `presetRegexScripts`
      // 导致验收表恒显示 0，掩盖了"预设正则没有随之导入"的问题。
      regex: prepared.bundle.regexScripts?.length ?? 0,
      warnings: prepared.report.warnings.length,
      warningCodes: summarizeCodes(prepared.report.warnings),
      errors: prepared.report.errors.length,
      elapsedMs: roundMs(startedAt),
    };
  } catch (error) {
    return {
      file: basename(absolutePath),
      bytes: metadata.size,
      kind: "invalid",
      elapsedMs: roundMs(startedAt),
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main(): Promise<void> {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error("用法：npm run verify:preset-samples -- <预设1.json> [预设2.json ...]");
    process.exitCode = 1;
    return;
  }
  const results = await Promise.all(paths.map(verifyPresetSample));
  console.table(results);
  if (results.some((result) => result.kind === "invalid" || (result.errors ?? 0) > 0)) {
    process.exitCode = 1;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function roundMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 10) / 10;
}

function summarizeCodes(items: ReadonlyArray<{ code: string }>): string {
  const counts = new Map<string, number>();
  items.forEach((item) => counts.set(item.code, (counts.get(item.code) ?? 0) + 1));
  return [...counts.entries()].map(([code, count]) => `${code}:${count}`).join(", ");
}

void main();