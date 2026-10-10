import type { CharacterCard } from "../../../types";

/**
 * `{{setvar}}` / `{{getvar}}` 的作用域。
 *
 * SillyTavern 语义（`public/scripts/variables.js` 的 `getVariableMacros`）：
 * 两个宏读写「当前聊天变量」，一次替换中先 set 后 get 可见，未设置时 `getvar`
 * 渲染为空串（`getLocalVariable` 缺失返回 `''`）。
 *
 * 本对象只承载「同一份提示词组装内」的工作集，用来把同一组装里前后区块串起来；
 * 会话变量的权威位置仍是 Compatibility Runtime 的命名空间
 * （`runtimePluginState["mobile-tavern.sillytavern-compat"]`，旧 `session.variables` 仅作读取降级），
 * 调用方负责用权威状态播种，禁止把它当成第二套变量存储去持久化。
 */
export interface PromptMacroVariableScope {
  get(name: string): string | undefined;
  set(name: string, value: string): void;
}

/**
 * 以权威会话变量播种一次组装的工作集。
 *
 * 只接受可直接渲染为文本的标量（字符串/数字/布尔）：`getvar` 的输出必须能直接进提示词，
 * 对象与数组会渲染成 `[object Object]`。MVU 状态表等结构化数据仍走
 * `{{format_message_variable::}}`，不在这里展开。
 */
export function createPromptMacroVariableScope(
  seed?: Record<string, unknown> | null,
): PromptMacroVariableScope {
  const values = new Map<string, string>();
  for (const [name, value] of Object.entries(seed ?? {})) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      values.set(name, String(value));
    }
  }
  return {
    get: (name) => values.get(name),
    set: (name, value) => {
      values.set(name, value);
    },
  };
}

/**
 * 变量宏正则与 ST 保持一致，不得为"更宽容"而放宽，否则会与官方行为分叉：
 * - `setvar`：名称不含 `:`，值不含 `}`（`[^}]*` 可跨行）；
 * - `getvar`：名称不含 `}`。
 * 因此包含 `}` 的正文会被 ST 同样地截断——这是来源格式的既有约束，不是本实现的缺陷。
 */
const SETVAR_MACRO = /\{\{setvar::([^:]+)::([^}]*)\}\}/gi;
const GETVAR_MACRO = /\{\{getvar::([^}]+)\}\}/gi;

export interface PromptMacroParams {
  char: string;
  user: string;
  description: string;
  personality: string;
  scenario: string;
  userPersona?: string;
  mes_example?: string;
  variables?: any;
  /** 变量宏作用域；缺省时 `{{setvar}}`/`{{getvar}}` 不做解释（保持既有原样保留行为）。 */
  variableScope?: PromptMacroVariableScope;
}

/** 将变量对象格式化为 YAML 字符串，并过滤 `$` 前缀隐藏变量。 */
export function formatVariablesAsYaml(variables: any): string {
  if (!variables || typeof variables !== "object") return "";
  const statData = variables.stat_data || variables;
  if (!statData || typeof statData !== "object" || Object.keys(statData).length === 0) return "";

  const filterHiddenKeys = (value: any): any => {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(filterHiddenKeys);
    const clean: Record<string, any> = {};
    for (const key of Object.keys(value)) {
      if (!key.startsWith("$")) clean[key] = filterHiddenKeys(value[key]);
    }
    return clean;
  };
  const cleanData = filterHiddenKeys(statData);
  if (Object.keys(cleanData).length === 0) return "";

  const toYaml = (value: any, depth = 0): string => {
    const indent = "  ".repeat(depth);
    if (value === null || value === undefined) return "null";
    if (typeof value !== "object") return String(value);
    if (Array.isArray(value)) {
      return "\n" + value.map((item) => `${indent}- ${toYaml(item, depth + 1)}`).join("\n");
    }
    return "\n" + Object.keys(value).map((key) => {
      const nested = value[key];
      return nested && typeof nested === "object"
        ? `${indent}${key}:${toYaml(nested, depth + 1)}`
        : `${indent}${key}: ${toYaml(nested, depth + 1)}`;
    }).join("\n");
  };

  return toYaml(cleanData).trim();
}

export function replacePromptMacros(text: string, params: PromptMacroParams): string {
  if (!text) return "";
  const cleanedText = text
    .replace(/\{+charr?\}+/gi, "{{char}}")
    .replace(/\{+chara?\}+/gi, "{{char}}")
    .replace(/\{+user_name\}+/gi, "{{user}}")
    .replace(/\{+user\}+/gi, "{{user}}");
  const macroMap: Record<string, string> = {
    char: params.char,
    chara: params.char,
    char_name: params.char,
    user: params.user,
    user_name: params.user,
    char_description: params.description,
    description: params.description,
    char_personality: params.personality,
    personality: params.personality,
    char_scenario: params.scenario,
    scenario: params.scenario,
    userpersona: params.userPersona || "",
    persona: params.userPersona || "",
  };
  if (params.mes_example !== undefined) {
    macroMap.mes_example = params.mes_example;
    macroMap.diags = params.mes_example;
    macroMap.example_dialogue = params.mes_example;
  }

  let result = cleanedText;
  const scope = params.variableScope;
  // 变量宏先于 `{{char}}` 等环境宏处理，与 ST 的 preEnvMacros 顺序一致；
  // 同一段文本内必须先 set 再 get，否则同块内「先写后读」会读到空值。
  if (scope) {
    result = result.replace(SETVAR_MACRO, (_match, name: string, value: string) => {
      const key = name.trim();
      // ST 对空变量名会抛错；宿主不在提示词组装期中断，降级为跳过写入并渲染为空。
      if (key) scope.set(key, value);
      return "";
    });
  }
  if (params.variables) {
    result = result.replace(/\{\{format_message_variable::([^}]+)\}\}/gi, (_match, path) => {
      const key = path.trim();
      return formatVariablesAsYaml(key === "stat_data" ? params.variables : (params.variables[key] || {}));
    });
  }
  // getvar 排在环境宏之前插入变量正文：插入内容若本身带 `{{char}}` 等宏，仍会被随后的
  // 环境宏替换（ST 的变量宏同样先于环境宏执行）。
  if (scope) {
    result = result.replace(GETVAR_MACRO, (_match, name: string) => scope.get(name.trim()) ?? "");
  }
  return result.replace(/\{\{([a-zA-Z0-9_]+)\}\}/gi, (match, key) =>
    macroMap[key.toLowerCase()] ?? match
  );
}

export function formatMvuVariablesForPrompt(variables: any, character?: CharacterCard): string {
  if (!variables || typeof variables !== "object") return "";
  const statData = variables.stat_data || variables;
  if (!statData || typeof statData !== "object" || Object.keys(statData).length === 0) return "";

  let hasReadOnly = false;
  const checkReadOnly = (value: any): void => {
    if (!value || typeof value !== "object" || hasReadOnly) return;
    for (const key of Object.keys(value)) {
      if (key.startsWith("_")) { hasReadOnly = true; return; }
      checkReadOnly(value[key]);
    }
  };
  checkReadOnly(statData);

  const yamlContent = formatVariablesAsYaml(variables);
  if (!yamlContent) return "";
  const mvuSettings = character?.extensions?.mvu_settings || character?.extensions?.mvu || character?.extensions?.MVU;
  const template = mvuSettings?.prompt_template;
  let result = typeof template === "string"
    ? template.replace(/\{\{variables\}\}/g, `\`\`\`yaml\n${yamlContent}\n\`\`\``)
    : `### 角色变量状态\n\`\`\`yaml\n${yamlContent}\n\`\`\``;
  if (hasReadOnly) {
    result += "\n重要指示：任何以下划线“_”开头的变量均为只读变量（由本地脚本维护计算），你必须仅读取它们，绝对不要在你的回复中通过 <UpdateVariable> 去尝试修改/写入它们！";
  }
  return result;
}
