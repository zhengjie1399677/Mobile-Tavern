import { useTranslation } from "../../contexts/LanguageContext";
import {
  isValidThemeStyleToken,
  THEME_INTERACTION_ACTION_TYPES,
  THEME_INTERACTION_LIMITS,
  THEME_MEDIA_SURFACES,
  type ThemeInteractionAction,
  type ThemeInteractionConfig,
  type ThemeStateDefinition,
  type ThemeStateValue,
} from "../../domain/themes/themeInteractionContract";
import { StateValueInput } from "./StateValueInput";

type ActionType = typeof THEME_INTERACTION_ACTION_TYPES[number];

function defaultStateValue(definition: ThemeStateDefinition): ThemeStateValue {
  if (definition.type === "boolean") return false;
  if (definition.type === "enum") return definition.values[0];
  return definition.default;
}

function firstKey(record: Record<string, unknown>): string | undefined {
  return Object.keys(record)[0];
}

function firstVideo(config: ThemeInteractionConfig): string | undefined {
  return Object.keys(config.media).find(key => config.media[key].type === "video");
}

function firstByStateType(
  config: ThemeInteractionConfig,
  type: ThemeStateDefinition["type"],
): string | undefined {
  return Object.keys(config.state).find(key => config.state[key].type === type);
}

function createAction(
  type: ActionType,
  config: ThemeInteractionConfig,
): ThemeInteractionAction | null {
  if (type === "media.play" || type === "media.pause" || type === "media.stop") {
    const target = firstKey(config.media);
    return target ? { action: type, target, delayMs: 0 } : null;
  }
  if (type === "media.setVolume") {
    const target = firstKey(config.media);
    return target ? { action: type, target, volume: 1, delayMs: 0 } : null;
  }
  if (type === "media.setMuted") {
    const target = firstVideo(config);
    return target ? { action: type, target, muted: true, delayMs: 0 } : null;
  }
  if (type === "surface.show") {
    const mediaId = firstVideo(config);
    return mediaId
      ? { action: type, target: "main.background", mediaId, delayMs: 0 }
      : null;
  }
  if (type === "surface.hide") {
    return { action: type, target: "main.background", delayMs: 0 };
  }
  if (type === "state.set") {
    const key = firstKey(config.state);
    return key
      ? { action: type, key, value: defaultStateValue(config.state[key]), delayMs: 0 }
      : null;
  }
  if (type === "state.toggle") {
    const key = firstByStateType(config, "boolean");
    return key ? { action: type, key, delayMs: 0 } : null;
  }
  if (type === "state.increment") {
    const key = firstByStateType(config, "counter");
    return key ? { action: type, key, amount: 1, delayMs: 0 } : null;
  }
  if (type === "theme.state.add" || type === "theme.state.remove") {
    return { action: type, value: "state-active", delayMs: 0 };
  }
  return { action: type, group: "state", value: "state-active", delayMs: 0 };
}

export function ActionListEditor({
  config,
  actions,
  onChange,
}: {
  config: ThemeInteractionConfig;
  actions: ThemeInteractionAction[];
  onChange: (actions: ThemeInteractionAction[]) => void;
}) {
  const { t } = useTranslation();
  const canAdd = actions.length < THEME_INTERACTION_LIMITS.maxActionsPerRule;

  const addAction = () => {
    const action = createAction("theme.state.add", config);
    if (!action) return;
    onChange([...actions, action]);
  };

  const updateAction = (index: number, action: ThemeInteractionAction) => {
    const next = [...actions];
    next[index] = action;
    onChange(next);
  };

  const removeAction = (index: number) => {
    onChange(actions.filter((_, itemIndex) => itemIndex !== index));
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-bold">{t("theme_studio.actions.title")}</h4>
        <button
          type="button"
          disabled={!canAdd}
          onClick={addAction}
          className="rounded-md border border-border px-2 py-1 text-[10px] font-semibold text-foreground disabled:opacity-50"
        >
          {t("theme_studio.actions.add")}
        </button>
      </div>

      {actions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-2.5 py-1.5 text-[10px] text-muted-foreground">
          {t("theme_studio.actions.empty")}
        </p>
      ) : (
        <div className="space-y-1.5">
          {actions.map((action, index) => {
            const stateDefinition = "key" in action ? config.state[action.key] : undefined;
            const mediaTargets = Object.keys(config.media);
            const videoTargets = Object.keys(config.media).filter(key => config.media[key].type === "video");
            const booleanStates = Object.keys(config.state).filter(key => config.state[key].type === "boolean");
            const counterStates = Object.keys(config.state).filter(key => config.state[key].type === "counter");
            return (
              <div key={index} className="space-y-1.5 rounded-lg border border-border bg-muted/20 p-2">
                <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <label className="text-[10px] text-muted-foreground">
                    {t("theme_studio.actions.type")}
                    <select
                      value={action.action}
                      onChange={event => {
                        const next = createAction(event.target.value as ActionType, config);
                        if (next) updateAction(index, next);
                      }}
                      className="mt-1 h-7 w-full rounded-md border border-border bg-input px-1.5 text-[10px] text-foreground"
                    >
                      {THEME_INTERACTION_ACTION_TYPES.map(type => (
                        <option key={type} value={type} disabled={!createAction(type, config)}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-[10px] text-muted-foreground">
                    {t("theme_studio.actions.delay")}
                    <input
                      type="number"
                      min={0}
                      max={THEME_INTERACTION_LIMITS.maxDelayMs}
                      step={100}
                      value={action.delayMs}
                      onChange={event => updateAction(index, {
                        ...action,
                        delayMs: Math.min(
                          THEME_INTERACTION_LIMITS.maxDelayMs,
                          Math.max(0, Number.parseInt(event.target.value, 10) || 0),
                        ),
                      })}
                      className="mt-1 h-7 w-full rounded-md border border-border bg-input px-1.5 text-[10px] text-foreground"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => removeAction(index)}
                    className="self-end rounded-md border border-destructive/40 px-2 py-1 text-[10px] font-semibold text-destructive"
                  >
                    {t("theme_studio.common.delete")}
                  </button>
                </div>

                <div className="grid gap-1.5 sm:grid-cols-2">
                  {action.action === "media.play" || action.action === "media.pause" ||
                    action.action === "media.stop" ? (
                      <label className="text-[10px] text-muted-foreground">
                        {t("theme_studio.actions.target")}
                        <select
                          value={action.target}
                          onChange={event => updateAction(index, { ...action, target: event.target.value })}
                          className="mt-1 h-7 w-full rounded-md border border-border bg-input px-1.5 text-[10px] text-foreground"
                        >
                          {mediaTargets.map(target => <option key={target} value={target}>{target}</option>)}
                        </select>
                      </label>
                    ) : null}

                  {action.action === "media.setVolume" && (
                    <>
                      <label className="text-[10px] text-muted-foreground">
                        {t("theme_studio.actions.target")}
                        <select
                          value={action.target}
                          onChange={event => updateAction(index, { ...action, target: event.target.value })}
                          className="mt-1 h-7 w-full rounded-md border border-border bg-input px-1.5 text-[10px] text-foreground"
                        >
                          {mediaTargets.map(target => <option key={target} value={target}>{target}</option>)}
                        </select>
                      </label>
                      <label className="text-[10px] text-muted-foreground">
                        {t("theme_studio.actions.volume")}
                        <input
                          type="number"
                          min={0}
                          max={1}
                          step={0.05}
                          value={action.volume}
                          onChange={event => updateAction(index, {
                            ...action,
                            volume: Math.min(1, Math.max(0, Number.parseFloat(event.target.value) || 0)),
                          })}
                          className="mt-1 h-7 w-full rounded-md border border-border bg-input px-1.5 text-[10px] text-foreground"
                        />
                      </label>
                    </>
                  )}

                  {action.action === "media.setMuted" && (
                    <>
                      <label className="text-[10px] text-muted-foreground">
                        {t("theme_studio.actions.target")}
                        <select
                          value={action.target}
                          onChange={event => updateAction(index, { ...action, target: event.target.value })}
                          className="mt-1 h-7 w-full rounded-md border border-border bg-input px-1.5 text-[10px] text-foreground"
                        >
                          {videoTargets.map(target => <option key={target} value={target}>{target}</option>)}
                          {!videoTargets.includes(action.target) && (
                            <option value={action.target}>{action.target}</option>
                          )}
                        </select>
                      </label>
                      <label className="flex items-center gap-1.5 self-end text-[10px] text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={action.muted}
                          onChange={event => updateAction(index, { ...action, muted: event.target.checked })}
                        />
                        {t("theme_studio.actions.muted")}
                      </label>
                    </>
                  )}

                  {action.action === "surface.show" && (
                    <>
                      <label className="text-[10px] text-muted-foreground">
                        {t("theme_studio.actions.surface")}
                        <select
                          value={action.target}
                          onChange={event => updateAction(index, {
                            ...action,
                            target: event.target.value as typeof THEME_MEDIA_SURFACES[number],
                          })}
                          className="mt-1 h-7 w-full rounded-md border border-border bg-input px-1.5 text-[10px] text-foreground"
                        >
                          {THEME_MEDIA_SURFACES.map(surface => <option key={surface} value={surface}>{surface}</option>)}
                        </select>
                      </label>
                      <label className="text-[10px] text-muted-foreground">
                        {t("theme_studio.actions.media")}
                        <select
                          value={action.mediaId}
                          onChange={event => updateAction(index, { ...action, mediaId: event.target.value })}
                          className="mt-1 h-7 w-full rounded-md border border-border bg-input px-1.5 text-[10px] text-foreground"
                        >
                          {videoTargets.map(target => <option key={target} value={target}>{target}</option>)}
                          {!videoTargets.includes(action.mediaId) && (
                            <option value={action.mediaId}>{action.mediaId}</option>
                          )}
                        </select>
                      </label>
                    </>
                  )}

                  {action.action === "surface.hide" && (
                    <label className="text-[10px] text-muted-foreground">
                      {t("theme_studio.actions.surface")}
                      <select
                        value={action.target}
                        onChange={event => updateAction(index, {
                          ...action,
                          target: event.target.value as typeof THEME_MEDIA_SURFACES[number],
                        })}
                        className="mt-1 h-7 w-full rounded-md border border-border bg-input px-1.5 text-[10px] text-foreground"
                      >
                        {THEME_MEDIA_SURFACES.map(surface => <option key={surface} value={surface}>{surface}</option>)}
                      </select>
                    </label>
                  )}

                  {action.action === "state.set" && (
                    <>
                      <label className="text-[10px] text-muted-foreground">
                        {t("theme_studio.actions.state_key")}
                        <select
                          value={action.key}
                          onChange={event => {
                            const definition = config.state[event.target.value];
                            updateAction(index, {
                              ...action,
                              key: event.target.value,
                              value: definition ? defaultStateValue(definition) : action.value,
                            });
                          }}
                          className="mt-1 h-7 w-full rounded-md border border-border bg-input px-1.5 text-[10px] text-foreground"
                        >
                          {Object.keys(config.state).map(key => <option key={key} value={key}>{key}</option>)}
                          {!stateDefinition && <option value={action.key}>{action.key}</option>}
                        </select>
                      </label>
                      <label className="text-[10px] text-muted-foreground">
                        {t("theme_studio.actions.value")}
                        <div className="mt-1">
                          <StateValueInput
                            definition={stateDefinition}
                            value={action.value}
                            onChange={value => updateAction(index, { ...action, value })}
                            ariaLabel={t("theme_studio.actions.value")}
                          />
                        </div>
                      </label>
                    </>
                  )}

                  {action.action === "state.toggle" && (
                    <label className="text-[10px] text-muted-foreground">
                      {t("theme_studio.actions.state_key")}
                      <select
                        value={action.key}
                        onChange={event => updateAction(index, { ...action, key: event.target.value })}
                        className="mt-1 h-7 w-full rounded-md border border-border bg-input px-1.5 text-[10px] text-foreground"
                      >
                        {booleanStates.map(key => <option key={key} value={key}>{key}</option>)}
                        {!booleanStates.includes(action.key) && <option value={action.key}>{action.key}</option>}
                      </select>
                    </label>
                  )}

                  {action.action === "state.increment" && (
                    <>
                      <label className="text-[10px] text-muted-foreground">
                        {t("theme_studio.actions.state_key")}
                        <select
                          value={action.key}
                          onChange={event => updateAction(index, { ...action, key: event.target.value })}
                          className="mt-1 h-7 w-full rounded-md border border-border bg-input px-1.5 text-[10px] text-foreground"
                        >
                          {counterStates.map(key => <option key={key} value={key}>{key}</option>)}
                          {!counterStates.includes(action.key) && <option value={action.key}>{action.key}</option>}
                        </select>
                      </label>
                      <label className="text-[10px] text-muted-foreground">
                        {t("theme_studio.actions.amount")}
                        <input
                          type="number"
                          min={-100}
                          max={100}
                          value={action.amount}
                          onChange={event => updateAction(index, {
                            ...action,
                            amount: Math.min(100, Math.max(-100, Number.parseInt(event.target.value, 10) || 0)),
                          })}
                          className="mt-1 h-7 w-full rounded-md border border-border bg-input px-1.5 text-[10px] text-foreground"
                        />
                      </label>
                    </>
                  )}

                  {(action.action === "theme.state.add" || action.action === "theme.state.remove") && (
                    <label className="text-[10px] text-muted-foreground">
                      {t("theme_studio.actions.token")}
                      <input
                        value={action.value}
                        onChange={event => updateAction(index, { ...action, value: event.target.value })}
                        className="mt-1 h-7 w-full rounded-md border border-border bg-input px-1.5 font-mono text-[10px] text-foreground"
                      />
                      {!isValidThemeStyleToken(action.value) && (
                        <span className="mt-1 block text-destructive">{t("theme_studio.actions.token_invalid")}</span>
                      )}
                    </label>
                  )}

                  {action.action === "theme.state.replace" && (
                    <>
                      <label className="text-[10px] text-muted-foreground">
                        {t("theme_studio.actions.group")}
                        <input
                          value={action.group}
                          onChange={event => updateAction(index, { ...action, group: event.target.value })}
                          className="mt-1 h-7 w-full rounded-md border border-border bg-input px-1.5 font-mono text-[10px] text-foreground"
                        />
                      </label>
                      <label className="text-[10px] text-muted-foreground">
                        {t("theme_studio.actions.token")}
                        <input
                          value={action.value}
                          onChange={event => updateAction(index, { ...action, value: event.target.value })}
                          className="mt-1 h-7 w-full rounded-md border border-border bg-input px-1.5 font-mono text-[10px] text-foreground"
                        />
                        {!action.value.startsWith(`${action.group}-`) && (
                          <span className="mt-1 block text-destructive">
                            {t("theme_studio.actions.prefix_invalid", { group: action.group })}
                          </span>
                        )}
                      </label>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
