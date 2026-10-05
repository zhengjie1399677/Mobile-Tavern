/**
 * 日期与时间上下文来源（SillyTavern 兼容宏）。
 *
 * 上游 SillyTavern 在 `public/scripts/macros.js` 里定义了这五个宏（release 分支）：
 *   {{time}}    -> moment().format('LT')      本地化时间
 *   {{date}}    -> moment().format('LL')      本地化长日期
 *   {{weekday}} -> moment().format('dddd')    本地化星期名
 *   {{isotime}} -> moment().format('HH:mm')   24 小时制
 *   {{isodate}} -> moment().format('YYYY-MM-DD')
 * 本仓没有 moment，改用 `Intl.DateTimeFormat`（与 official.device-time 的既有做法一致）。
 *
 * 这些宏此前完全未实现，卡片/预设里出现它们时会以字面量漏进提示词；现在作为
 * **注册来源（pull）**接入通用上下文来源缝，由来源自己读取当前时间。
 */
import type { ContextSourceDefinition } from "../../domain/contextSources/contracts";
import { readUiLanguage } from "../../infrastructure/i18n/uiLanguage";

export interface ClockContextSourceDeps {
  /** 注入时钟，便于测试；默认读取真实时间。 */
  readonly now?: () => Date;
  /** 注入语言；默认读取 UI 语言。 */
  readonly locale?: () => string;
}

const MAX_CHARACTERS = 64;
const TIMEOUT_MS = 1_000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function createDefinition(
  id: string,
  macroName: string,
  format: (date: Date, locale: string) => string,
  deps: ClockContextSourceDeps,
): ContextSourceDefinition {
  return {
    id,
    version: "1.0.0",
    macroName,
    // 时间随真实时钟变化，重生成可能不同；如实声明为 volatile。
    determinism: "volatile",
    maxCharacters: MAX_CHARACTERS,
    timeoutMs: TIMEOUT_MS,
    async read() {
      const date = deps.now?.() ?? new Date();
      const locale = deps.locale?.() ?? readUiLanguage();
      return format(date, locale);
    },
  };
}

/** 五个时间宏各自是一个来源，遵守「一个来源一个宏」的契约。 */
export function createClockContextSources(
  deps: ClockContextSourceDeps = {},
): readonly ContextSourceDefinition[] {
  return [
    createDefinition("clock.time", "time", (date, locale) =>
      new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(date), deps),
    createDefinition("clock.date", "date", (date, locale) =>
      new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(date), deps),
    createDefinition("clock.weekday", "weekday", (date, locale) =>
      new Intl.DateTimeFormat(locale, { weekday: "long" }).format(date), deps),
    createDefinition("clock.isotime", "isotime", (date) =>
      `${pad(date.getHours())}:${pad(date.getMinutes())}`, deps),
    createDefinition("clock.isodate", "isodate", (date) =>
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, deps),
  ];
}
