import type { CharacterCard } from "../../../types";

export interface PromptMacroParams {
  char: string;
  user: string;
  description: string;
  personality: string;
  scenario: string;
  userPersona?: string;
  mes_example?: string;
  variables?: any;
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
  if (params.variables) {
    result = result.replace(/\{\{format_message_variable::([^}]+)\}\}/gi, (_match, path) => {
      const key = path.trim();
      return formatVariablesAsYaml(key === "stat_data" ? params.variables : (params.variables[key] || {}));
    });
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
