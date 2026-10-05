import type { CustomPromptBlock } from "../../types";

/**
 * 设置界面"常用提示词模版库"的可选内容数据。
 *
 * 这些模组只在用户主动点击时加入当前预设，不会由系统自动注入，因此不属于
 * `COMPAT-DATA` 禁止的"行为引导硬编码进通用系统代码"；但内容属于数据而非界面逻辑，
 * 单独存放在领域数据模块里，避免 UI 组件同时承担渲染与提示词文案维护。
 */

export interface PromptTemplateItem {
  name: string;
  role: NonNullable<CustomPromptBlock["role"]>;
  content: string;
  badge: string;
  description: string;
}

export const RECOMMENDED_PROMPT_TEMPLATES: readonly PromptTemplateItem[] = [
  {
    name: "沉浸式第二人称描写",
    role: "system",
    content: "【描写规范】以第二人称“你”指代玩家（{{user}}）。注重动作肢体细节、面部微表情、五感体验与当下环境互动，保持临场沉浸感。",
    badge: "视角沉浸",
    description: "以‘你’称呼玩家，强化场景感官交互",
  },
  {
    name: "去除AI腔与自然口语",
    role: "system",
    content: "【文风禁忌】严禁说教、长篇大论或使用AI套话（如“正如...所说”、“这不仅是...更是...”等）。保持真实口语与自然情绪流动。",
    badge: "去AI套话",
    description: "杜绝说教与总结式AI腔，更像真人交流",
  },
  {
    name: "心理与微表情描写",
    role: "system",
    content: "【心理描写】在台词与动作之间，适度描写角色的内心活动、犹豫或潜意识反应，丰富人物立体感。",
    badge: "人物立体",
    description: "丰富对话间的心理活动与潜意识流",
  },
  {
    name: "严禁代玩家做决定",
    role: "system",
    content: "【边界约束】严禁替玩家（{{user}}）发言或做出决定。每次回复停留在你的角色行动和反应之后，等待玩家的下一步互动。",
    badge: "行为边界",
    description: "避免抢话或替玩家擅自做决定",
  },
];
