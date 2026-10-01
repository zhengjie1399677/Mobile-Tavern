import type { PromptBlock } from "../../domain/prompt-composition";

export interface WorkflowNodeTemplate {
  id: string;
  category: "role" | "context" | "rules" | "advanced";
  name: string;
  description: string;
  role: PromptBlock["role"];
  source: PromptBlock["source"];
  template: string;
  placement: PromptBlock["placement"];
  recommendedOrder: number;
}

export const WORKFLOW_NODE_TEMPLATES: WorkflowNodeTemplate[] = [
  {
    id: "node_character_def",
    category: "role",
    name: "角色资料与人设",
    description: "自动注入角色卡中的描述、性格、场景及系统提示词。",
    role: "system",
    source: { type: "template" },
    template: "{{character.description}}\n\n{{character.personality}}\n\n{{character.scenario}}\n\n{{character.systemPrompt}}",
    placement: { type: "ordered" },
    recommendedOrder: 200,
  },
  {
    id: "node_user_persona",
    category: "role",
    name: "用户人设与称谓",
    description: "注入当前玩家的名字、人设简介与称呼习惯。",
    role: "system",
    source: { type: "template" },
    template: "【用户设定】\n称呼：{{persona.name}}\n人设：{{persona.description}}",
    placement: { type: "ordered" },
    recommendedOrder: 250,
  },
  {
    id: "node_worldbook",
    category: "context",
    name: "世界书动态触发点",
    description: "在当前上下文位置动态扫描并插入匹配关键词的世界设定。",
    role: "system",
    source: { type: "template" },
    template: "{{worldbook.triggered}}",
    placement: { type: "ordered" },
    recommendedOrder: 300,
  },
  {
    id: "node_memory",
    category: "context",
    name: "剧情记忆与表格状态",
    description: "注入阶段剧情总结、向量关联记忆及角色状态大纲表格。",
    role: "system",
    source: { type: "template" },
    template: "{{memory.summaries}}\n\n{{memory.recalled}}\n\n{{memory.tables}}",
    placement: { type: "ordered" },
    recommendedOrder: 400,
  },
  {
    id: "node_chat_history_recent",
    category: "context",
    name: "近期对话历史（自动截断）",
    description: "保留最近 20 条消息上下文并保留首条开场白，控制 Token 开销。",
    role: "system",
    source: {
      type: "chat_history",
      selection: { mode: "recent", count: 20, preserveFirstAssistant: true },
    },
    template: "",
    placement: { type: "ordered" },
    recommendedOrder: 500,
  },
  {
    id: "node_chat_history_all",
    category: "context",
    name: "完整对话历史",
    description: "将当前会话的历史消息全量送入上下文。",
    role: "system",
    source: {
      type: "chat_history",
      selection: { mode: "all" },
    },
    template: "",
    placement: { type: "ordered" },
    recommendedOrder: 500,
  },
  {
    id: "node_depth_jailbreak",
    category: "rules",
    name: "深度注入破限/风格强化",
    description: "在历史消息倒数第 4 条处深度插入规则守卫，抵抗上下文遗忘。",
    role: "system",
    source: { type: "template" },
    template: "{{prompt.jailbreak}}\n\n[注意：严格保持角色性格沉浸与生动动作描写，禁止以 AI 助手口吻出戏。]",
    placement: { type: "in_chat", depth: 4 },
    recommendedOrder: 600,
  },
  {
    id: "node_post_history",
    category: "rules",
    name: "历史后置指令 (Post-History)",
    description: "紧随对话历史尾部插入的短期高优先级行为指令。",
    role: "system",
    source: { type: "template" },
    template: "{{prompt.postHistory}}",
    placement: { type: "ordered" },
    recommendedOrder: 700,
  },
  {
    id: "node_reasoning_guidance",
    category: "advanced",
    name: "思维链推演与动作指引",
    description: "引导模型在内部推演角色心理与环境微表情后再行作答。",
    role: "system",
    source: { type: "template" },
    template: "[内心推演要求]\n回复前请在内心思考：\n1. 角色当前情感与潜在动机；\n2. 周围环境光线、声音对氛围的影响；\n3. 以充满文学色彩的动作与对话推进互动。",
    placement: { type: "ordered" },
    recommendedOrder: 150,
  },
  {
    id: "node_custom_blank",
    category: "advanced",
    name: "空白自由文本节点",
    description: "完全自主编写的提示词区块，支持任意全局宏变量。",
    role: "system",
    source: { type: "template" },
    template: "// 自定义提示词内容\n",
    placement: { type: "ordered" },
    recommendedOrder: 800,
  },
];

/**
 * 根据模版创建可直接插入编排的 PromptBlock 实例。
 */
export function createBlockFromTemplate(
  template: WorkflowNodeTemplate,
  existingBlocks: PromptBlock[]
): PromptBlock {
  const maxOrder = existingBlocks.length === 0
    ? 0
    : Math.max(...existingBlocks.map((b) => b.order));
  const order = Math.max(template.recommendedOrder, maxOrder + 50);
  const id = `block_${template.id.replace(/^node_/, "")}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  return {
    id,
    name: template.name,
    enabled: true,
    role: template.role,
    source: structuredClone(template.source),
    template: template.template,
    order,
    placement: structuredClone(template.placement),
  };
}
