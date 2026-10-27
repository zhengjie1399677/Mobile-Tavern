import React from "react";
import { BookOpen, ChevronDown, Layers } from "lucide-react";
import type { PromptAuditSnapshot } from "../../domain/promptAudit";
import { useTranslation } from "../../contexts/LanguageContext";

interface PromptAuditTabProps {
  audit: PromptAuditSnapshot | null;
}

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

  if (!audit) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center text-xs text-muted-foreground">
        <Layers className="size-5 text-muted-foreground/70" aria-hidden="true" />
        <p>{t("prompt_audit.empty")}</p>
      </div>
    );
  }

  const triggerLabel = (entry: PromptAuditSnapshot["lorebook"]["entries"][number]) => {
    if (entry.trigger === "keyword") {
      return t("prompt_audit.trigger_keyword").replace("{key}", entry.matchedKey ?? "—");
    }
    return entry.trigger === "sticky"
      ? t("prompt_audit.trigger_sticky")
      : t("prompt_audit.trigger_constant");
  };

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
            {audit.lorebook.entries.map((entry) => (
              <li
                key={entry.id}
                className="rounded-lg border border-border/60 bg-muted/30 px-2.5 py-2"
                data-trigger={entry.trigger}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 break-words text-[11px] font-medium text-foreground">
                    {entry.title}
                  </span>
                  <span className="shrink-0 rounded bg-background/80 px-1.5 py-0.5 text-[9px] text-muted-foreground">
                    {t(entry.source === "character"
                      ? "prompt_audit.source_character"
                      : "prompt_audit.source_global")}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                  <span>{triggerLabel(entry)}</span>
                  {entry.keys.length > 0 && (
                    <span className="min-w-0 break-words">{entry.keys.join(" / ")}</span>
                  )}
                  <span>{t("prompt_audit.chars").replace("{chars}", String(entry.chars))}</span>
                </div>
              </li>
            ))}
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
