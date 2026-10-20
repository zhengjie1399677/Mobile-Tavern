import { useEffect, useState } from "react";
import { useTranslation } from "../../contexts/LanguageContext";
import {
  THEME_INTERACTION_LIMITS,
  type ThemeInteractionConfig,
  type ThemeInteractionIssue,
  type ThemeInteractionRule,
} from "../../domain/themes/themeInteractionContract";
import { createThemeRuleId } from "../../domain/themes/themeInteractionDraft";
import { useMobileBackHandler } from "../../hooks/useMobileBackHandler";
import { RuleDetailEditor } from "./RuleDetailEditor";

function createRule(config: ThemeInteractionConfig): ThemeInteractionRule {
  return {
    id: createThemeRuleId(config),
    when: { event: "theme.activate" },
    if: [],
    do: [{ action: "theme.state.add", value: "state-active", delayMs: 0 }],
    cooldownMs: THEME_INTERACTION_LIMITS.minCooldownMs,
    once: false,
  };
}

export function RulesEditor({
  config,
  issues,
  onChange,
}: {
  config: ThemeInteractionConfig;
  issues: ThemeInteractionIssue[];
  onChange: (config: ThemeInteractionConfig) => void;
}) {
  const { t } = useTranslation();
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const editingIndex = config.interactions.findIndex(rule => rule.id === editingRuleId);

  useEffect(() => {
    if (editingRuleId && editingIndex < 0) setEditingRuleId(null);
  }, [editingRuleId, editingIndex]);

  useMobileBackHandler(Boolean(editingRuleId), () => {
    setEditingRuleId(null);
    return true;
  }, 860);

  const updateRule = (index: number, rule: ThemeInteractionRule) => {
    const next = [...config.interactions];
    next[index] = rule;
    onChange({ ...config, interactions: next });
  };

  const addRule = () => {
    if (config.interactions.length >= THEME_INTERACTION_LIMITS.maxRules) return;
    const rule = createRule(config);
    onChange({ ...config, interactions: [...config.interactions, rule] });
    setEditingRuleId(rule.id);
  };

  const duplicateRule = (index: number) => {
    if (config.interactions.length >= THEME_INTERACTION_LIMITS.maxRules) return;
    const source = config.interactions[index];
    const copy: ThemeInteractionRule = {
      ...source,
      id: createThemeRuleId(config),
      when: { ...source.when },
      if: [...source.if],
      do: source.do.map(action => ({ ...action })),
    };
    const next = [...config.interactions];
    next.splice(index + 1, 0, copy);
    onChange({ ...config, interactions: next });
    setEditingRuleId(copy.id);
  };

  const removeRule = (index: number) => {
    const next = config.interactions.filter((_, itemIndex) => itemIndex !== index);
    onChange({ ...config, interactions: next });
    if (config.interactions[index]?.id === editingRuleId) setEditingRuleId(null);
  };

  const moveRule = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= config.interactions.length) return;
    const next = [...config.interactions];
    [next[index], next[target]] = [next[target], next[index]];
    onChange({ ...config, interactions: next });
  };

  if (editingIndex >= 0) {
    const rule = config.interactions[editingIndex];
    return (
      <RuleDetailEditor
        rule={rule}
        ruleIndex={editingIndex}
        config={config}
        issues={issues}
        onChange={next => updateRule(editingIndex, next)}
        onBack={() => setEditingRuleId(null)}
      />
    );
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-bold">{t("theme_studio.rules.title")}</h3>
          <p className="mt-0.5 text-[10px] text-muted-foreground">{t("theme_studio.rules.hint")}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {config.interactions.length} / {THEME_INTERACTION_LIMITS.maxRules}
          </span>
          <button
            type="button"
            disabled={config.interactions.length >= THEME_INTERACTION_LIMITS.maxRules}
            onClick={addRule}
            className="rounded-md bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            {t("theme_studio.rules.add")}
          </button>
        </div>
      </div>

      {config.interactions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-[10px] text-muted-foreground">
          {t("theme_studio.rules.empty")}
        </p>
      ) : (
        <div className="space-y-1.5">
          {config.interactions.map((rule, index) => (
            <div key={rule.id} className="rounded-lg border border-border bg-muted/20 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-mono text-[11px] font-semibold text-foreground">{rule.id}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {rule.when.event} · {t("theme_studio.rules.condition_count", { count: rule.if.length })}
                    {" · "}
                    {t("theme_studio.rules.action_count", { count: rule.do.length })}
                    {" · "}
                    {t("theme_studio.rules.cooldown_short", { value: rule.cooldownMs })}
                    {rule.once ? ` · ${t("theme_studio.rules.once")}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingRuleId(rule.id)}
                  className="shrink-0 rounded-md border border-border px-2 py-1 text-[10px] font-semibold text-foreground"
                >
                  {t("theme_studio.rules.edit")}
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => moveRule(index, -1)}
                  className="rounded border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground disabled:opacity-40"
                >
                  {t("theme_studio.rules.move_up")}
                </button>
                <button
                  type="button"
                  disabled={index === config.interactions.length - 1}
                  onClick={() => moveRule(index, 1)}
                  className="rounded border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground disabled:opacity-40"
                >
                  {t("theme_studio.rules.move_down")}
                </button>
                <button
                  type="button"
                  onClick={() => duplicateRule(index)}
                  className="rounded border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground"
                >
                  {t("theme_studio.rules.duplicate")}
                </button>
                <button
                  type="button"
                  onClick={() => removeRule(index)}
                  className="rounded border border-destructive/40 px-1.5 py-0.5 text-[9px] font-semibold text-destructive"
                >
                  {t("theme_studio.common.delete")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
