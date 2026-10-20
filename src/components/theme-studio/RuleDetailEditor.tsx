import { ArrowLeft } from "lucide-react";
import { useTranslation } from "../../contexts/LanguageContext";
import {
  THEME_INTERACTION_EVENT_TYPES,
  THEME_ORIENTATIONS,
  type ThemeInteractionConfig,
  type ThemeInteractionIssue,
  type ThemeInteractionRule,
  type ThemeInteractionEventType,
} from "../../domain/themes/themeInteractionContract";
import { ActionListEditor } from "./ActionListEditor";
import { ConditionListEditor } from "./ConditionListEditor";

function whenForEvent(
  event: ThemeInteractionEventType,
  rule: ThemeInteractionRule,
  config: ThemeInteractionConfig,
): ThemeInteractionRule["when"] {
  if (event === "ui.tap") return { event, target: rule.when.target ?? "main-tab" };
  if (event === "tab.enter" || event === "tab.leave") {
    return { event, tabId: rule.when.tabId ?? "chat" };
  }
  if (event === "orientation.change") {
    return { event, orientation: rule.when.orientation ?? "portrait" };
  }
  if (event === "media.ended") {
    return { event, mediaId: rule.when.mediaId ?? Object.keys(config.media)[0] };
  }
  return { event };
}

export function RuleDetailEditor({
  rule,
  ruleIndex,
  config,
  issues,
  onChange,
  onBack,
}: {
  rule: ThemeInteractionRule;
  ruleIndex: number;
  config: ThemeInteractionConfig;
  issues: ThemeInteractionIssue[];
  onChange: (rule: ThemeInteractionRule) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const ruleIssues = issues.filter(issue => (
    issue.path[0] === "interactions" && issue.path[1] === ruleIndex
  ));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex size-7 items-center justify-center rounded-md border border-border text-foreground"
          aria-label={t("theme_studio.rules.back")}
        >
          <ArrowLeft className="size-3.5" />
        </button>
        <div className="min-w-0">
          <p className="text-xs font-bold">{t("theme_studio.rules.detail_title")}</p>
          <p className="truncate font-mono text-[10px] text-muted-foreground">{rule.id}</p>
        </div>
      </div>

      {ruleIssues.length > 0 && (
        <ul className="space-y-0.5 rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-1.5">
          {ruleIssues.map((issue, index) => (
            <li key={`${issue.path.join(".")}-${index}`} className="text-[10px] leading-relaxed text-destructive">
              <span className="font-mono">{issue.path.join(".")}</span>：{issue.message}
            </li>
          ))}
        </ul>
      )}

      <section className="space-y-2 rounded-lg border border-border bg-card p-2.5">
        <h4 className="text-[11px] font-bold">{t("theme_studio.rules.trigger")}</h4>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-[10px] text-muted-foreground">
            {t("theme_studio.rules.id")}
            <input
              value={rule.id}
              onChange={event => onChange({ ...rule, id: event.target.value })}
              className="mt-1 h-7 w-full rounded-md border border-border bg-input px-1.5 font-mono text-[10px] text-foreground"
            />
          </label>
          <label className="text-[10px] text-muted-foreground">
            {t("theme_studio.rules.event")}
            <select
              value={rule.when.event}
              onChange={event => onChange({
                ...rule,
                when: whenForEvent(event.target.value as ThemeInteractionEventType, rule, config),
              })}
              className="mt-1 h-7 w-full rounded-md border border-border bg-input px-1.5 text-[10px] text-foreground"
            >
              {THEME_INTERACTION_EVENT_TYPES.map(event => (
                <option key={event} value={event}>{event}</option>
              ))}
            </select>
          </label>

          {rule.when.event === "ui.tap" && (
            <label className="text-[10px] text-muted-foreground">
              {t("theme_studio.rules.tap_target")}
              <input
                value={rule.when.target ?? ""}
                onChange={event => onChange({
                  ...rule,
                  when: { ...rule.when, target: event.target.value },
                })}
                className="mt-1 h-7 w-full rounded-md border border-border bg-input px-1.5 font-mono text-[10px] text-foreground"
              />
            </label>
          )}

          {(rule.when.event === "tab.enter" || rule.when.event === "tab.leave") && (
            <label className="text-[10px] text-muted-foreground">
              {t("theme_studio.rules.tab_id")}
              <input
                value={rule.when.tabId ?? ""}
                onChange={event => onChange({
                  ...rule,
                  when: { ...rule.when, tabId: event.target.value },
                })}
                className="mt-1 h-7 w-full rounded-md border border-border bg-input px-1.5 font-mono text-[10px] text-foreground"
              />
            </label>
          )}

          {rule.when.event === "orientation.change" && (
            <label className="text-[10px] text-muted-foreground">
              {t("theme_studio.rules.orientation")}
              <select
                value={rule.when.orientation ?? "portrait"}
                onChange={event => onChange({
                  ...rule,
                  when: { ...rule.when, orientation: event.target.value as "portrait" | "landscape" },
                })}
                className="mt-1 h-7 w-full rounded-md border border-border bg-input px-1.5 text-[10px] text-foreground"
              >
                {THEME_ORIENTATIONS.map(orientation => (
                  <option key={orientation} value={orientation}>{orientation}</option>
                ))}
              </select>
            </label>
          )}

          {rule.when.event === "media.ended" && (
            <label className="text-[10px] text-muted-foreground">
              {t("theme_studio.rules.media_id")}
              <select
                value={rule.when.mediaId ?? ""}
                onChange={event => onChange({
                  ...rule,
                  when: { ...rule.when, mediaId: event.target.value || undefined },
                })}
                className="mt-1 h-7 w-full rounded-md border border-border bg-input px-1.5 text-[10px] text-foreground"
              >
                <option value="">{t("theme_studio.rules.any_media")}</option>
                {Object.keys(config.media).map(mediaId => (
                  <option key={mediaId} value={mediaId}>{mediaId}</option>
                ))}
              </select>
            </label>
          )}

          <label className="text-[10px] text-muted-foreground">
            {t("theme_studio.rules.cooldown")}
            <input
              type="number"
              min={100}
              max={60000}
              step={100}
              value={rule.cooldownMs}
              onChange={event => onChange({
                ...rule,
                cooldownMs: Math.min(60000, Math.max(100, Number.parseInt(event.target.value, 10) || 100)),
              })}
              className="mt-1 h-7 w-full rounded-md border border-border bg-input px-1.5 text-[10px] text-foreground"
            />
          </label>
          <label className="flex items-center gap-1.5 self-end text-[10px] text-muted-foreground">
            <input
              type="checkbox"
              checked={rule.once}
              onChange={event => onChange({ ...rule, once: event.target.checked })}
            />
            {t("theme_studio.rules.once")}
          </label>
        </div>
      </section>

      <ConditionListEditor
        config={config}
        conditions={rule.if}
        onChange={conditions => onChange({ ...rule, if: conditions })}
      />

      <ActionListEditor
        config={config}
        actions={rule.do}
        onChange={actions => onChange({ ...rule, do: actions })}
      />
    </div>
  );
}
