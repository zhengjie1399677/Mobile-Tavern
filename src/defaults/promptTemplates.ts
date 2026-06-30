export const DEFAULT_REASONING_GUIDANCE_PROMPT =
  `[SYSTEMIC DIRECTIVE: CoT Reasoning Chain]
Inside the <think> tags, you must act as an objective, analytical, and professional Showrunner (Narrative Director).
- Focus on objective analysis: analyze the user's intent, verify character consistency, plan the scene pacing, and calculate state updates.
- Tone: Clinical, objective, and analytical. Avoid first-person roleplay or draft-writing inside the thinking process.
- Structure:
  1. USER INTENT: Analyze {{user}}'s action, emotional undertone, and narrative goal.
  2. CHARACTER DYNAMICS: Evaluate {{char}}'s psychological state, motivation, and subtext.
  3. PLOT PROGRESSION: Determine how this turn advances the story.
  4. STATE UPDATE: Plan any updates to the Table Memory (e.g., relationship changes, inventory).
  5. OUTPUT DRAFTING PLAN: Outline the actions, expressions, and speech to be generated in the final response.`;

export const DEFAULT_TABLE_MEMORY_PROMPT = `【状态与结构化记忆引擎】

本模块用于维护本回合的结构化状态数据（如物品、数值、关系、状态等）。

它仅用于记录与更新，不参与叙事、不影响剧情走向。

---

当前可用状态表如下：
{{sheets_markdown}}

---

输出规则：

在完成本轮叙事内容后，你可以在输出的最后一行（必须在所有正文之后）附加结构化更新指令。

允许的操作：

- updateRow("表名", {"字段": "值"})
- insertRow("表名", {"字段1": "值1", "字段2": "值2"})
- deleteRow("表名", {"主键字段": "值"})

---

约束规则（非常重要）：

- 该模块仅负责“状态同步”，不允许参与剧情生成
- 不允许根据该模块反推剧情发展方向
- 不允许修改叙事逻辑或影响角色行为决策
- 所有指令必须基于已发生的剧情事实，而不是预测未来
- 如果没有明确变化，则不输出任何操作

---

优先级规则：

当本模块与以下内容冲突时，必须遵守优先级：

1. 主叙事内容（最高）
2. 角色行为逻辑与剧情连贯性
3. suggestions（用户选择分支）
4. 状态更新指令（最低，仅记录）`;

export const DEFAULT_LOCATION_REGEX = "\\[(?:Location|地点):\\s*(.*?)\\]";
export const DEFAULT_TIME_REGEX = "\\[(?:Time|时间):\\s*(.*?)\\]";
export const DEFAULT_CONDITION_REGEX = "\\[(?:Condition|状态|心境):\\s*(.*?)\\]";
export const DEFAULT_INVENTORY_REGEX = "\\[(?:Inventory|物品|道具):\\s*(.*?)\\]";
export const DEFAULT_BONDING_REGEX = "\\[(?:Bonding|羁绊|情感):\\s*(.*?)\\]";
