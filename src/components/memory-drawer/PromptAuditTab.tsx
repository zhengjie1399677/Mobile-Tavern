import React from "react";
import { BookOpen, ChevronDown, KeyRound, Layers, Link2, Pin } from "lucide-react";
import type { PromptAuditSnapshot } from "../../domain/promptAudit";
import { useTranslation } from "../../contexts/LanguageContext";

interface PromptAuditTabProps {
  audit: PromptAuditSnapshot | null;
}

type LorebookEntry = PromptAuditSnapshot["lorebook"]["entries"][number];

/**
 * 三种命中方式的视觉编码：常驻保持中性灰（它永远在那儿，不需要被注意），
 * 粘性延续用琥珀色，关键词命中用绿色（本轮真正被打亮的条目）。
 * 颜色只做辅助，徽章里始终带文字，色弱用户也能读懂。
 */
const TRIGGER_STYLES: Record<
  LorebookEntry["trigger"],
  { Icon: typeof Pin; badge: string; accent: string; row: string }
> = {
  constant: {
    Icon: Pin,
    badge: "border-border/70 bg-background/80 text-muted-foreground",
    accent: "border-l-border",
    row: "bg-muted/30",
  },
  sticky: {
    Icon: Link2,
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    accent: "border-l-amber-500/60",
    row: "bg-amber-500/[0.04]",
  },
  keyword: {
    Icon: KeyRound,
    badge: "border-emerald-500/35 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    accent: "border-l-emerald-500/70",
    row: "bg-emerald-500/[0.05]",
  },
};

const TriggerBadge: React.FC<{ entry: LorebookEntry }> = ({ entry }) => {
  const { t } = useTranslation();
  const { Icon, badge } = TRIGGER_STYLES[entry.trigger];
  // 标签文案统一是「前缀{key}」的形状，按占位符切开，让关键词本身用等宽字体突出。
  const [prefix] = t("prompt_audit.trigger_keyword").split("{key}");
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-medium leading-none ${badge}`}
    >
      <Icon className="size-2.5" aria-hidden="true" />
      {entry.trigger === "keyword" ? (
        <>
          <span>{prefix.trim()}</span>
          <span className="font-mono">{entry.matchedKey ?? "—"}</span>
        </>
      ) : (
        <span>
          {t(
            entry.trigger === "sticky"
              ? "prompt_audit.trigger_sticky"
              : "prompt_audit.trigger_constant",
          )}
        </span>
      )}
    </span>
  );
};

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * 「本轮提示词」面板：只读展示最近一次 Prompt 组装的审计结果。
 *
 * 数据来自 useChat 的运行时瞬态快照，不落盘；发新消息时被整体替换，
 * 因此这里不提供编辑入口，只解释「命中了哪些世界书、提示词被分成了哪些块」。
 */
export const PromptAuditTab: React.FC<PromptAuditTabProps> = ({ audit }) => {
  const { t } = useTranslation();
  const [openSectionId, setOpenSectionId] = React.useState<string | null>(null);
  // 世界书条目允许多条同时展开：对比「命中了什么、为什么命中」时需要同时看几条正文。
  const [openEntryIds, setOpenEntryIds] = React.useState<ReadonlySet<string>>(() => new Set());

  const toggleEntry = React.useCallback((entryId: string) => {
    setOpenEntryIds((previous) => {
      const next = new Set(previous);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }, []);

  if (!audit) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center text-xs text-muted-foreground">
        <Layers className="size-5 text-muted-foreground/70" aria-hidden="true" />
        <p>{t("prompt_audit.empty")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-ui="prompt-audit">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span>{t("prompt_audit.captured_at").replace("{time}", formatTime(audit.capturedAt))}</span>
        {audit.generationType && (
          <span>{t("prompt_audit.generation").replace("{type}", audit.generationType)}</span>
        )}
      </div>

      <section className="flex flex-col gap-2">
        <header className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <BookOpen className="size-3.5 text-muted-foreground" aria-hidden="true" />
            {t("prompt_audit.lorebook_title")}
          </h3>
          <span className="text-[10px] text-muted-foreground">
            {t("prompt_audit.lorebook_summary")
              .replace("{hit}", String(audit.lorebook.entries.length))
              .replace("{candidate}", String(audit.lorebook.candidateCount))
              .replace("{budget}", String(audit.lorebook.budgetChars))}
          </span>
        </header>

        {audit.lorebook.entries.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/70 px-3 py-2 text-[11px] text-muted-foreground">
            {t("prompt_audit.lorebook_empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {audit.lorebook.entries.map((entry) => {
              const expanded = openEntryIds.has(entry.id);
              const style = TRIGGER_STYLES[entry.trigger];
              // 关键词命中的行已经写了命中的那个词，这里只补「其余备选关键词」，避免同一串词出现两次。
              const listedKeys =
                entry.trigger === "keyword"
                  ? entry.keys.filter((key) => key !== entry.matchedKey)
                  : entry.keys;
              return (
                <li
                  key={entry.id}
                  className={`overflow-hidden rounded-lg border border-l-2 border-border/60 ${style.accent} ${style.row}`}
                  data-trigger={entry.trigger}
                >
                  <button
                    type="button"
                    onClick={() => toggleEntry(entry.id)}
                    aria-expanded={expanded}
                    aria-label={entry.title}
                    className="flex w-full flex-col gap-1 px-2.5 py-2 text-left transition-colors hover:bg-background/40"
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0 break-words text-[11px] font-medium text-foreground">
                        {entry.title}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span className="rounded bg-background/80 px-1.5 py-0.5 text-[9px] text-muted-foreground">
                          {t(entry.source === "character"
                            ? "prompt_audit.source_character"
                            : "prompt_audit.source_global")}
                        </span>
                        <ChevronDown
                          className={`size-3 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
                          aria-hidden="true"
                        />
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
                      <TriggerBadge entry={entry} />
                      {listedKeys.length > 0 && (
                        <span className="min-w-0 truncate font-mono text-muted-foreground/80">
                          {listedKeys.join(" / ")}
                        </span>
                      )}
                      <span className="ml-auto shrink-0 tabular-nums">
                        {t("prompt_audit.chars").replace("{chars}", String(entry.chars))}
                      </span>
                    </span>
                  </button>
                  {expanded && (
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-border/50 bg-background/70 px-2.5 py-2 text-[10px] leading-relaxed text-foreground/90">
                      {entry.content || t("prompt_audit.section_empty")}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {audit.lorebook.budgetDropped.length > 0 && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-[10px] text-amber-600 dark:text-amber-400">
            {t("prompt_audit.budget_dropped")
              .replace("{count}", String(audit.lorebook.budgetDropped.length))
              .replace("{titles}", audit.lorebook.budgetDropped.map((drop) => drop.title).join("、"))}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <header className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Layers className="size-3.5 text-muted-foreground" aria-hidden="true" />
            {t("prompt_audit.prompt_title")}
          </h3>
          <span className="text-[10px] text-muted-foreground">
            {t("prompt_audit.prompt_summary")
              .replace("{system}", String(audit.prompt.systemChars))
              .replace("{history}", String(audit.prompt.historyChars))
              .replace("{user}", String(audit.prompt.userInputChars))}
          </span>
        </header>

        {audit.prompt.sections.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/70 px-3 py-2 text-[11px] text-muted-foreground">
            {t("prompt_audit.prompt_empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {audit.prompt.sections.map((section) => {
              const expanded = openSectionId === section.id;
              return (
                <li key={section.id} className="rounded-lg border border-border/60 bg-muted/30">
                  <button
                    type="button"
                    onClick={() => setOpenSectionId(expanded ? null : section.id)}
                    aria-expanded={expanded}
                    className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block break-words text-[11px] font-medium text-foreground">
                        {section.title}
                      </span>
                      <span className="text-[9px] text-muted-foreground">{section.phase}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground">
                      {t("prompt_audit.chars").replace("{chars}", String(section.chars))}
                      <ChevronDown
                        className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`}
                        aria-hidden="true"
                      />
                    </span>
                  </button>
                  {expanded && (
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-border/50 bg-background/70 px-2.5 py-2 text-[10px] leading-relaxed text-foreground/90">
                      {section.content || t("prompt_audit.section_empty")}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
};
