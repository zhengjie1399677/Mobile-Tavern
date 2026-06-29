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

export const DEFAULT_TABLE_MEMORY_PROMPT = `[STATE ENGINE: Structured Memory Ledger]
Below are the active structured state and memory tables for this session.
Based on the narrative progression in this turn, you may output pseudo-code instructions at the very end of your response (on a new line, after all content) to update the tables.
Available Operations:
- updateRow("tableName", {"column": "value"})
- insertRow("tableName", {"column1": "value1", "column2": "value2"})
- deleteRow("tableName", {"keyColumn": "keyValue"})

Active Tables:
{{sheets_markdown}}`;

export const DEFAULT_LOCATION_REGEX = "\\[(?:Location|地点):\\s*(.*?)\\]";
export const DEFAULT_TIME_REGEX = "\\[(?:Time|时间):\\s*(.*?)\\]";
export const DEFAULT_CONDITION_REGEX = "\\[(?:Condition|状态|心境):\\s*(.*?)\\]";
export const DEFAULT_INVENTORY_REGEX = "\\[(?:Inventory|物品|道具):\\s*(.*?)\\]";
export const DEFAULT_BONDING_REGEX = "\\[(?:Bonding|羁绊|情感):\\s*(.*?)\\]";
