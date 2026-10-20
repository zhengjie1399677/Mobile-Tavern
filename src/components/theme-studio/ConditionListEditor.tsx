import { useTranslation } from "../../contexts/LanguageContext";
import {
  THEME_INTERACTION_CONDITION_TYPES,
  THEME_INTERACTION_LIMITS,
  type ThemeInteractionCondition,
  type ThemeInteractionConfig,
  type ThemeStateDefinition,
  type ThemeStateValue,
} from "../../domain/themes/themeInteractionContract";
import { StateValueInput } from "./StateValueInput";
import { ThemeStudioSelect } from "./ThemeStudioSelect";
import { useThemeStudioTypeLabels } from "./themeStudioTypeLabels";

type ConditionType = typeof THEME_INTERACTION_CONDITION_TYPES[number];

function defaultStateValue(definition: ThemeStateDefinition): ThemeStateValue {
  if (definition.type === "boolean") return false;
  if (definition.type === "enum") return definition.values[0];
  return definition.default;
}

function createCondition(
  type: ConditionType,
  config: ThemeInteractionConfig,
): ThemeInteractionCondition | null {
  if (type === "state.equals") {
    const key = Object.keys(config.state)[0];
    if (!key) return null;
    return { condition: "state.equals", key, value: defaultStateValue(config.state[key]) };
  }
  if (type === "tab.is") return { condition: "tab.is", value: "chat" };
  if (type === "orientation.is") return { condition: "orientation.is", value: "portrait" };
  if (type === "media.enabled") return { condition: "media.enabled", value: true };
  return { condition: "accessibility.reducedMotion", value: true };
}

export function ConditionListEditor({
  config,
  conditions,
  onChange,
}: {
  config: ThemeInteractionConfig;
  conditions: ThemeInteractionCondition[];
  onChange: (conditions: ThemeInteractionCondition[]) => void;
}) {
  const { t } = useTranslation();
  const labels = useThemeStudioTypeLabels();
  const canAdd = conditions.length < THEME_INTERACTION_LIMITS.maxConditionsPerRule;

  const addCondition = () => {
    const condition = createCondition("state.equals", config) ?? createCondition("tab.is", config);
    if (!condition) return;
    onChange([...conditions, condition]);
  };

  const updateCondition = (index: number, condition: ThemeInteractionCondition) => {
    const next = [...conditions];
    next[index] = condition;
    onChange(next);
  };

  const removeCondition = (index: number) => {
    onChange(conditions.filter((_, itemIndex) => itemIndex !== index));
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-bold">{t("theme_studio.conditions.title")}</h4>
        <button
          type="button"
          disabled={!canAdd}
          onClick={addCondition}
          className="rounded-md border border-border px-2 py-1 text-[10px] font-semibold text-foreground disabled:opacity-50"
        >
          {t("theme_studio.conditions.add")}
        </button>
      </div>

      {conditions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-2.5 py-1.5 text-[10px] text-muted-foreground">
          {t("theme_studio.conditions.empty")}
        </p>
      ) : (
        <div className="space-y-1.5">
          {conditions.map((condition, index) => {
            const stateDefinition = condition.condition === "state.equals"
              ? config.state[condition.key]
              : undefined;
            const stateMissing = condition.condition === "state.equals" && !stateDefinition;
            return (
              <div key={index} className="grid gap-1.5 rounded-lg border border-border bg-muted/20 p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <label className="text-[10px] text-muted-foreground">
                  {t("theme_studio.conditions.type")}
                  <ThemeStudioSelect
                    value={condition.condition}
                    options={THEME_INTERACTION_CONDITION_TYPES.map(type => ({
                      value: type,
                      label: labels.condition(type),
                      disabled: type === "state.equals" && Object.keys(config.state).length === 0,
                    }))}
                    onValueChange={value => {
                      const next = createCondition(value as ConditionType, config);
                      if (next) updateCondition(index, next);
                    }}
                    className="mt-1 w-full border-border bg-input text-[10px]"
                    ariaLabel={t("theme_studio.conditions.type")}
                    size="sm"
                  />
                </label>

                <div className="text-[10px] text-muted-foreground">
                  {condition.condition === "state.equals" && (
                    <>
                      <span className="block">{t("theme_studio.conditions.state_key")}</span>
                      <ThemeStudioSelect
                        value={condition.key}
                        options={[
                          ...Object.keys(config.state).map(key => ({ value: key, label: key })),
                          ...(stateMissing ? [{ value: condition.key, label: condition.key }] : []),
                        ]}
                        onValueChange={key => {
                          const definition = config.state[key];
                          updateCondition(index, {
                            ...condition,
                            key,
                            value: definition ? defaultStateValue(definition) : condition.value,
                          });
                        }}
                        className="mt-1 w-full border-border bg-input text-[10px]"
                        ariaLabel={t("theme_studio.conditions.state_key")}
                        size="sm"
                      />
                      {stateMissing && (
                        <span className="mt-1 block text-destructive">{t("theme_studio.conditions.state_missing")}</span>
                      )}
                    </>
                  )}
                  {condition.condition === "tab.is" && (
                    <>
                      <span className="block">{t("theme_studio.conditions.tab_id")}</span>
                      <input
                        value={condition.value}
                        onChange={event => updateCondition(index, { ...condition, value: event.target.value })}
                        className="mt-1 h-7 w-full rounded-md border border-border bg-input px-1.5 text-[10px] text-foreground"
                      />
                    </>
                  )}
                  {condition.condition === "orientation.is" && (
                    <>
                      <span className="block">{t("theme_studio.conditions.orientation")}</span>
                      <ThemeStudioSelect
                        value={condition.value}
                        options={[
                          { value: "portrait", label: labels.orientation("portrait") },
                          { value: "landscape", label: labels.orientation("landscape") },
                        ]}
                        onValueChange={value => updateCondition(index, {
                          ...condition,
                          value: value as "portrait" | "landscape",
                        })}
                        className="mt-1 w-full border-border bg-input text-[10px]"
                        ariaLabel={t("theme_studio.conditions.orientation")}
                        size="sm"
                      />
                    </>
                  )}
                  {condition.condition === "media.enabled" && (
                    <>
                      <span className="block">{t("theme_studio.conditions.media_enabled")}</span>
                      <ThemeStudioSelect
                        value={String(condition.value)}
                        options={[
                          { value: "true", label: labels.booleanValue(true) },
                          { value: "false", label: labels.booleanValue(false) },
                        ]}
                        onValueChange={value => updateCondition(index, { ...condition, value: value === "true" })}
                        className="mt-1 w-full border-border bg-input text-[10px]"
                        ariaLabel={t("theme_studio.conditions.media_enabled")}
                        size="sm"
                      />
                    </>
                  )}
                  {condition.condition === "accessibility.reducedMotion" && (
                    <>
                      <span className="block">{t("theme_studio.conditions.reduced_motion")}</span>
                      <ThemeStudioSelect
                        value={String(condition.value)}
                        options={[
                          { value: "true", label: labels.booleanValue(true) },
                          { value: "false", label: labels.booleanValue(false) },
                        ]}
                        onValueChange={value => updateCondition(index, { ...condition, value: value === "true" })}
                        className="mt-1 w-full border-border bg-input text-[10px]"
                        ariaLabel={t("theme_studio.conditions.reduced_motion")}
                        size="sm"
                      />
                    </>
                  )}
                </div>

                {condition.condition === "state.equals" && (
                  <div className="text-[10px] text-muted-foreground">
                    <span className="block">{t("theme_studio.conditions.value")}</span>
                    <div className="mt-1">
                      <StateValueInput
                        definition={stateDefinition}
                        value={condition.value}
                        onChange={value => updateCondition(index, { ...condition, value })}
                        ariaLabel={t("theme_studio.conditions.value")}
                      />
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => removeCondition(index)}
                  className="self-end rounded-md border border-destructive/40 px-2 py-1 text-[10px] font-semibold text-destructive"
                >
                  {t("theme_studio.common.delete")}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
