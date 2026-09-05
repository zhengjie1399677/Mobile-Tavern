import { useEffect, useMemo, useState } from "react";
import { Check, Play, Save, SlidersHorizontal, Wrench } from "lucide-react";
import type { CharacterCard, SamplerPreset, SavedPresetBundle } from "../../types";
import type {
  RuntimeProfileAgentSettings,
  RuntimeProfileRecord,
  RuntimeProfileToolMount,
} from "../../application/runtimeProfiles/contracts";

interface AgentProfileEditorProps {
  readonly profile: RuntimeProfileRecord;
  readonly characters: readonly CharacterCard[];
  readonly promptPresets: readonly SavedPresetBundle[];
  readonly fallbackSampling: SamplerPreset;
  readonly tools: readonly RuntimeProfileToolMount[];
  readonly unavailableToolNames?: readonly string[];
  readonly busy: boolean;
  readonly onSave: (agent: RuntimeProfileAgentSettings) => Promise<void>;
  readonly onSaveAndStart: (agent: RuntimeProfileAgentSettings) => Promise<void>;
}

export default function AgentProfileEditor({
  profile,
  characters,
  promptPresets,
  fallbackSampling,
  tools,
  unavailableToolNames = [],
  busy,
  onSave,
  onSaveAndStart,
}: AgentProfileEditorProps) {
  const [characterId, setCharacterId] = useState(profile.agent?.characterId ?? "");
  const [promptPresetId, setPromptPresetId] = useState(profile.agent?.promptPresetId ?? "");
  const [selectedToolNames, setSelectedToolNames] = useState(
    () => new Set(profile.agent?.toolMounts.map((tool) => tool.name) ?? tools.map((tool) => tool.name)),
  );
  const [customSampling, setCustomSampling] = useState(profile.agent?.sampling !== undefined);
  const [sampling, setSampling] = useState(() => profile.agent?.sampling ?? toSampling(fallbackSampling));

  useEffect(() => {
    setCharacterId(profile.agent?.characterId ?? "");
    setPromptPresetId(profile.agent?.promptPresetId ?? "");
    setSelectedToolNames(new Set(
      profile.agent?.toolMounts.map((tool) => tool.name) ?? tools.map((tool) => tool.name),
    ));
    setCustomSampling(profile.agent?.sampling !== undefined);
    setSampling(profile.agent?.sampling ?? toSampling(fallbackSampling));
  }, [fallbackSampling, profile, tools]);

  const selectedPreset = useMemo(
    () => promptPresets.find((preset) => preset.id === promptPresetId),
    [promptPresetId, promptPresets],
  );
  const editable = !profile.builtin;
  const buildAgent = (): RuntimeProfileAgentSettings => ({
    characterId: characterId || undefined,
    promptPresetId: promptPresetId || undefined,
    toolMounts: tools
      .filter((tool) => selectedToolNames.has(tool.name))
      .map((tool) => ({ ...tool })),
    sampling: customSampling ? { ...sampling } : undefined,
  });
  const toggleTool = (name: string) => {
    setSelectedToolNames((previous) => {
      const next = new Set(previous);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div className="space-y-3 rounded-2xl border border-border/70 bg-card/40 p-3 backdrop-blur-xs">
      <div>
        <h3 className="text-xs sm:text-[13px] font-bold text-foreground">Agent 基础装配</h3>
        <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted-foreground/80">
          依次选择角色、Tool 与行为。配置只保存引用；角色卡、预设正文和凭据仍留在原存储中。
        </p>
      </div>

      {!editable && (
        <div className="rounded-xl border border-border/60 bg-muted/30 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
          内置 Profile 为只读模板。先点击“复制”，再编辑副本。
        </div>
      )}

      <div className="space-y-3">
        <label className="block text-[11px] font-semibold text-foreground" htmlFor={`agent-character-${profile.id}`}>
          1. 角色
          <select
            id={`agent-character-${profile.id}`}
            value={characterId}
            disabled={!editable || busy}
            onChange={(event) => setCharacterId(event.target.value)}
            className="mt-1 h-8.5 w-full rounded-xl border border-border/70 bg-background/80 px-2.5 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary/60 disabled:opacity-50 shadow-2xs"
          >
            <option value="">尚未选择</option>
            {characterId && !characters.some((character) => character.id === characterId) && (
              <option value={characterId}>缺失角色：{characterId}</option>
            )}
            {characters.map((character) => (
              <option key={character.id} value={character.id}>{character.name}</option>
            ))}
          </select>
          <span className="mt-1 block font-normal text-[10px] text-muted-foreground/75 leading-tight">
            “保存并开始”需要有效角色；导入后缺失的角色会明确提示。
          </span>
        </label>
      </div>

      <fieldset disabled={!editable || busy} className="space-y-1.5">
        <legend className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
          <Wrench aria-hidden="true" className="h-3.5 w-3.5 text-primary" />
          <span>2. Tool 工具挂载</span>
        </legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {tools.map((tool) => {
            const checked = selectedToolNames.has(tool.name);
            const unavailable = unavailableToolNames.includes(tool.name);
            return (
              <button
                key={tool.name}
                type="button"
                role="checkbox"
                aria-checked={checked}
                disabled={!editable || busy}
                onClick={() => toggleTool(tool.name)}
                className={`flex h-9 items-center gap-2 rounded-xl border px-2.5 text-left transition-all active:scale-[0.99] disabled:opacity-50 shadow-2xs ${
                  unavailable
                    ? "border-amber-500/40 bg-amber-500/10"
                    : checked
                      ? "border-primary/45 bg-primary/10"
                      : "border-border/60 bg-background/70 hover:border-primary/30"
                }`}
              >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-md border ${
                  checked ? "border-primary bg-primary text-primary-foreground" : "border-border/80"
                }`}>
                  {checked && <Check aria-hidden="true" className="h-3 w-3" />}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="block truncate text-[11px] font-semibold text-foreground">{tool.name}</span>
                  <span className="block truncate text-[9px] text-muted-foreground/75">
                    {unavailable ? "未安装或版本不匹配" : `v${tool.version ?? "未声明"}`}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="space-y-3">
        <label className="block text-[11px] font-semibold text-foreground" htmlFor={`agent-preset-${profile.id}`}>
          3. 行为预设
          <select
            id={`agent-preset-${profile.id}`}
            value={promptPresetId}
            disabled={!editable || busy}
            onChange={(event) => {
              const nextId = event.target.value;
              setPromptPresetId(nextId);
              const nextPreset = promptPresets.find((preset) => preset.id === nextId);
              if (nextPreset && !customSampling) setSampling(toSampling(nextPreset.preset));
            }}
            className="mt-1 h-8.5 w-full rounded-xl border border-border/70 bg-background/80 px-2.5 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary/60 disabled:opacity-50 shadow-2xs"
          >
            <option value="">沿用全局行为</option>
            {promptPresetId && !promptPresets.some((preset) => preset.id === promptPresetId) && (
              <option value={promptPresetId}>缺失预设：{promptPresetId}</option>
            )}
            {promptPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.preset.name}</option>
            ))}
          </select>
          <span className="mt-1 block font-normal text-[10px] text-muted-foreground/75 leading-tight">
            {selectedPreset ? `已引用：${selectedPreset.preset.name}` : "未选择时使用会话当前全局 Prompt 与 Regex。"}
          </span>
        </label>
      </div>

      <details className="rounded-xl border border-border/60 bg-background/60 p-2.5 shadow-2xs">
        <summary className="flex min-h-7 cursor-pointer list-none items-center gap-1.5 text-xs font-bold text-foreground select-none">
          <SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5 text-primary" />
          <span>高级采样覆盖</span>
          <span className="ml-auto text-[9.5px] font-mono text-muted-foreground">
            {customSampling ? "Agent 覆盖" : "随行为预设"}
          </span>
        </summary>
        <label className="mt-2 flex h-8 items-center gap-2 rounded-xl border border-border/60 bg-background/50 px-2.5 text-[11px] text-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={customSampling}
            disabled={!editable || busy}
            onChange={(event) => setCustomSampling(event.target.checked)}
            className="h-4 w-4 accent-primary rounded"
          />
          为此 Agent 固定采样参数
        </label>
        {customSampling && (
          <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <NumberField label="Temperature" value={sampling.temperature} min={0} max={5} step={0.05} disabled={!editable || busy} onChange={(temperature) => setSampling((value) => ({ ...value, temperature }))} />
            <NumberField label="Top P" value={sampling.topP} min={0} max={1} step={0.05} disabled={!editable || busy} onChange={(topP) => setSampling((value) => ({ ...value, topP }))} />
            <NumberField label="Top K" value={sampling.topK} min={0} max={1000} step={1} disabled={!editable || busy} onChange={(topK) => setSampling((value) => ({ ...value, topK }))} />
            <NumberField label="Max Tokens" value={sampling.maxTokens} min={1} max={1_000_000} step={1} disabled={!editable || busy} onChange={(maxTokens) => setSampling((value) => ({ ...value, maxTokens }))} />
            <NumberField label="Repetition" value={sampling.repetitionPenalty} min={0} max={5} step={0.05} disabled={!editable || busy} onChange={(repetitionPenalty) => setSampling((value) => ({ ...value, repetitionPenalty }))} />
            <NumberField label="Frequency" value={sampling.frequencyPenalty ?? 0} min={-2} max={2} step={0.05} disabled={!editable || busy} onChange={(frequencyPenalty) => setSampling((value) => ({ ...value, frequencyPenalty }))} />
            <NumberField label="Presence" value={sampling.presencePenalty ?? 0} min={-2} max={2} step={0.05} disabled={!editable || busy} onChange={(presencePenalty) => setSampling((value) => ({ ...value, presencePenalty }))} />
            <NumberField label="Min P" value={sampling.minP ?? 0} min={0} max={1} step={0.05} disabled={!editable || busy} onChange={(minP) => setSampling((value) => ({ ...value, minP }))} />
          </div>
        )}
      </details>

      {editable && (
        <div className="grid gap-2 sm:grid-cols-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onSave(buildAgent())}
            className="flex h-8.5 items-center justify-center gap-1.5 rounded-xl border border-primary/35 bg-background/80 px-3 text-xs font-bold text-primary transition-all hover:bg-primary/10 active:scale-95 disabled:opacity-50 shadow-2xs"
          >
            <Save aria-hidden="true" className="h-3.5 w-3.5" />
            <span>保存配置</span>
          </button>
          <button
            type="button"
            disabled={busy || !characterId}
            onClick={() => void onSaveAndStart(buildAgent())}
            className="flex h-8.5 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-bold text-primary-foreground transition-all hover:brightness-105 active:scale-95 disabled:opacity-50 shadow-xs"
          >
            <Play aria-hidden="true" className="h-3.5 w-3.5" />
            <span>保存并开始新会话</span>
          </button>
        </div>
      )}
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly disabled: boolean;
  readonly onChange: (value: number) => void;
}) {
  return (
    <label className="text-[10px] font-semibold text-muted-foreground">
      {label}
      <input
        type="number"
        inputMode={step === 1 ? "numeric" : "decimal"}
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
        className="mt-1 h-8 w-full rounded-xl border border-border/70 bg-background/80 px-2 text-xs font-mono text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary/60 disabled:opacity-50 shadow-2xs"
      />
    </label>
  );
}

function toSampling(preset: SamplerPreset) {
  return {
    temperature: preset.temperature,
    topP: preset.topP,
    topK: preset.topK,
    repetitionPenalty: preset.repetitionPenalty,
    frequencyPenalty: preset.frequencyPenalty,
    presencePenalty: preset.presencePenalty,
    minP: preset.minP,
    maxTokens: preset.maxTokens,
  };
}
