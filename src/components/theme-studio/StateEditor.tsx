import { useState } from "react";
import { useTranslation } from "../../contexts/LanguageContext";
import {
  isValidThemeStateKey,
  isValidThemeStyleToken,
  THEME_INTERACTION_LIMITS,
  type ThemeInteractionConfig,
  type ThemeStateDefinition,
} from "../../domain/themes/themeInteractionContract";
import { createThemeStateKey } from "../../domain/themes/themeInteractionDraft";
import { EnumValuesInput } from "./EnumValuesInput";
import { ThemeStudioSelect } from "./ThemeStudioSelect";
import { useThemeStudioTypeLabels } from "./themeStudioTypeLabels";

function stateToken(key: string, definition: ThemeStateDefinition): string {
  return `${key}-${definition.default}`;
}

function parseEnumValues(raw: string): string[] {
  return [...new Set(raw.split(",").map(item => item.trim()).filter(Boolean))];
}

/** 先截到契约上限 16 个，再决定默认值，避免默认值落在被截掉的位置。 */
function buildEnumDefinition(
  values: string[],
  preferredDefault: string,
): ThemeStateDefinition | null {
  const limited = values.slice(0, 16);
  if (limited.length === 0 || !limited.every(isValidThemeStyleToken)) return null;
  return {
    type: "enum",
    values: limited,
    default: limited.includes(preferredDefault) ? preferredDefault : limited[0],
  };
}

export function StateEditor({
  config,
  onChange,
}: {
  config: ThemeInteractionConfig;
  onChange: (config: ThemeInteractionConfig) => void;
}) {
  const { t } = useTranslation();
  const labels = useThemeStudioTypeLabels();
  const [stateKey, setStateKey] = useState(() => createThemeStateKey(config));
  const [stateType, setStateType] = useState<"boolean" | "enum" | "counter">("boolean");
  const [booleanDefault, setBooleanDefault] = useState(false);
  const [enumValues, setEnumValues] = useState("calm, dream");
  const [enumDefault, setEnumDefault] = useState("calm");
  const [counterMin, setCounterMin] = useState(0);
  const [counterMax, setCounterMax] = useState(10);
  const [counterDefault, setCounterDefault] = useState(0);
  const stateCount = Object.keys(config.state).length;

  const parsedEnumValues = parseEnumValues(enumValues);
  const newDefinition: ThemeStateDefinition | null = stateType === "boolean"
    ? { type: "boolean", default: booleanDefault }
    : stateType === "enum"
      ? buildEnumDefinition(parsedEnumValues, enumDefault)
      : (counterMin <= counterMax
        ? {
            type: "counter",
            min: counterMin,
            max: counterMax,
            default: Math.min(counterMax, Math.max(counterMin, counterDefault)),
          }
        : null);

  const canAdd = Boolean(
    newDefinition &&
    isValidThemeStateKey(stateKey) &&
    !config.state[stateKey] &&
    stateCount < THEME_INTERACTION_LIMITS.maxStateFields,
  );

  const addState = () => {
    if (!canAdd || !newDefinition) return;
    const next: ThemeInteractionConfig = {
      ...config,
      state: { ...config.state, [stateKey]: newDefinition },
    };
    onChange(next);
    setStateKey(createThemeStateKey(next));
  };

  const updateState = (key: string, definition: ThemeStateDefinition) => {
    onChange({ ...config, state: { ...config.state, [key]: definition } });
  };

  const removeState = (key: string) => {
    const nextState = { ...config.state };
    delete nextState[key];
    onChange({ ...config, state: nextState });
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-bold">{t("theme_studio.state.title")}</h3>
          <p className="mt-0.5 text-[10px] text-muted-foreground">{t("theme_studio.state.hint")}</p>
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
          {stateCount} / {THEME_INTERACTION_LIMITS.maxStateFields}
        </span>
      </div>

      <div className="grid gap-2 rounded-lg border border-border bg-card p-2.5 sm:grid-cols-2">
        <label className="text-[10px] text-muted-foreground">
          {t("theme_studio.state.key")}
          <input
            value={stateKey}
            onChange={event => setStateKey(event.target.value)}
            className="mt-1 h-8 w-full rounded-lg border border-border bg-input px-2 font-mono text-xs text-foreground"
          />
        </label>
        <label className="text-[10px] text-muted-foreground">
          {t("theme_studio.state.type")}
          <ThemeStudioSelect
            value={stateType}
            options={[
              { value: "boolean", label: labels.stateType("boolean") },
              { value: "enum", label: labels.stateType("enum") },
              { value: "counter", label: labels.stateType("counter") },
            ]}
            onValueChange={value => setStateType(value as "boolean" | "enum" | "counter")}
            className="mt-1 w-full border-border bg-input text-xs"
            ariaLabel={t("theme_studio.state.type")}
            size="default"
          />
        </label>

        {stateType === "boolean" && (
          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground sm:col-span-2">
            <input
              type="checkbox"
              checked={booleanDefault}
              onChange={event => setBooleanDefault(event.target.checked)}
            />
            {t("theme_studio.state.default")}: {String(booleanDefault)}
          </label>
        )}

        {stateType === "enum" && (
          <>
            <label className="text-[10px] text-muted-foreground">
              {t("theme_studio.state.enum_values")}
              <input
                value={enumValues}
                onChange={event => setEnumValues(event.target.value)}
                placeholder="calm, dream"
                className="mt-1 h-8 w-full rounded-lg border border-border bg-input px-2 font-mono text-xs text-foreground"
              />
            </label>
            <label className="text-[10px] text-muted-foreground">
              {t("theme_studio.state.default")}
              <ThemeStudioSelect
                value={enumDefault}
                options={parsedEnumValues.map(value => ({ value, label: value }))}
                onValueChange={setEnumDefault}
                className="mt-1 w-full border-border bg-input text-xs"
                ariaLabel={t("theme_studio.state.default")}
                size="default"
              />
            </label>
          </>
        )}

        {stateType === "counter" && (
          <>
            <label className="text-[10px] text-muted-foreground">
              {t("theme_studio.state.min")}
              <input
                type="number"
                value={counterMin}
                onChange={event => setCounterMin(Number.parseInt(event.target.value, 10) || 0)}
                className="mt-1 h-8 w-full rounded-lg border border-border bg-input px-2 text-xs text-foreground"
              />
            </label>
            <label className="text-[10px] text-muted-foreground">
              {t("theme_studio.state.max")}
              <input
                type="number"
                value={counterMax}
                onChange={event => setCounterMax(Number.parseInt(event.target.value, 10) || 0)}
                className="mt-1 h-8 w-full rounded-lg border border-border bg-input px-2 text-xs text-foreground"
              />
            </label>
            <label className="text-[10px] text-muted-foreground">
              {t("theme_studio.state.default")}
              <input
                type="number"
                value={counterDefault}
                onChange={event => setCounterDefault(Number.parseInt(event.target.value, 10) || 0)}
                className="mt-1 h-8 w-full rounded-lg border border-border bg-input px-2 text-xs text-foreground"
              />
            </label>
          </>
        )}

        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <button
            type="button"
            disabled={!canAdd}
            onClick={addState}
            className="rounded-md bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            {t("theme_studio.state.add")}
          </button>
          {!isValidThemeStateKey(stateKey) && (
            <span className="text-[10px] text-destructive">{t("theme_studio.state.key_invalid")}</span>
          )}
          {stateType === "enum" && parsedEnumValues.length === 0 && (
            <span className="text-[10px] text-destructive">{t("theme_studio.state.enum_invalid")}</span>
          )}
          {stateType === "enum" && parsedEnumValues.some(value => !isValidThemeStyleToken(value)) && (
            <span className="text-[10px] text-destructive">{t("theme_studio.state.enum_token_invalid")}</span>
          )}
          {stateType === "counter" && counterMin > counterMax && (
            <span className="text-[10px] text-destructive">{t("theme_studio.state.counter_invalid")}</span>
          )}
        </div>
      </div>

      {stateCount === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-[10px] text-muted-foreground">
          {t("theme_studio.state.empty")}
        </p>
      ) : (
        <div className="space-y-2">
          {Object.entries(config.state).map(([key, definition]) => (
            <div key={key} className="space-y-2 rounded-lg border border-border bg-muted/20 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-mono text-[11px] font-semibold text-foreground">{key}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {labels.stateType(definition.type)} · {stateToken(key, definition)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeState(key)}
                  className="shrink-0 rounded-md border border-destructive/40 px-2 py-1 text-[10px] font-semibold text-destructive"
                >
                  {t("theme_studio.state.delete")}
                </button>
              </div>

              {definition.type === "boolean" ? (
                <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={definition.default}
                    onChange={event => updateState(key, { ...definition, default: event.target.checked })}
                  />
                  {t("theme_studio.state.default")}: {String(definition.default)}
                </label>
              ) : definition.type === "enum" ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="text-[10px] text-muted-foreground">
                    {t("theme_studio.state.enum_values")}
                    <EnumValuesInput
                      values={definition.values}
                      ariaLabel={t("theme_studio.state.enum_values")}
                      onChange={values => updateState(key, {
                        ...definition,
                        values,
                        default: values.includes(definition.default) ? definition.default : (values[0] ?? ""),
                      })}
                      className="mt-1 h-7 w-full rounded-lg border border-border bg-input px-1.5 font-mono text-[10px] text-foreground"
                    />
                  </label>
                  <label className="text-[10px] text-muted-foreground">
                    {t("theme_studio.state.default")}
                    <ThemeStudioSelect
                      value={definition.default}
                      options={definition.values.map(value => ({ value, label: value }))}
                      onValueChange={value => updateState(key, { ...definition, default: value })}
                      className="mt-1 w-full border-border bg-input text-[10px]"
                      ariaLabel={t("theme_studio.state.default")}
                      size="sm"
                    />
                  </label>
                  {(definition.values.length > 16 || definition.values.some(value => !isValidThemeStyleToken(value))) && (
                    <p className="text-[10px] text-destructive sm:col-span-2">
                      {definition.values.length > 16
                        ? t("theme_studio.state.enum_count_invalid")
                        : t("theme_studio.state.enum_token_invalid")}
                    </p>
                  )}
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-3">
                  <label className="text-[10px] text-muted-foreground">
                    {t("theme_studio.state.min")}
                    <input
                      type="number"
                      value={definition.min}
                      onChange={event => updateState(key, {
                        ...definition,
                        min: Number.parseInt(event.target.value, 10) || 0,
                      })}
                      className="mt-1 h-7 w-full rounded-lg border border-border bg-input px-1.5 text-[10px] text-foreground"
                    />
                  </label>
                  <label className="text-[10px] text-muted-foreground">
                    {t("theme_studio.state.max")}
                    <input
                      type="number"
                      value={definition.max}
                      onChange={event => updateState(key, {
                        ...definition,
                        max: Number.parseInt(event.target.value, 10) || 0,
                      })}
                      className="mt-1 h-7 w-full rounded-lg border border-border bg-input px-1.5 text-[10px] text-foreground"
                    />
                  </label>
                  <label className="text-[10px] text-muted-foreground">
                    {t("theme_studio.state.default")}
                    <input
                      type="number"
                      value={definition.default}
                      onChange={event => updateState(key, {
                        ...definition,
                        default: Number.parseInt(event.target.value, 10) || 0,
                      })}
                      className="mt-1 h-7 w-full rounded-lg border border-border bg-input px-1.5 text-[10px] text-foreground"
                    />
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
