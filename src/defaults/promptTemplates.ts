export const DEFAULT_REASONING_GUIDANCE_PROMPT =
  "[System Note: AI should perform objective, logical analysis inside <think> tags in a solver perspective (e.g. analyzing user intentions, character traits, and plan next actions), rather than roleplaying, chatting, or generating dialogue prefixes inside <think>.]";

export const DEFAULT_TABLE_MEMORY_PROMPT = `=== 🎯 长期状态与记忆档案柜 ===
以下是当前扮演会话中记录的结构化状态与记忆表格。
在生成下一轮扮演回复时，请根据聊天发展，在回复内容的【最末尾】输出更新指令伪代码（由你自主决定是否更新，只能包含合法可执行的代码，不要添加多余文字解释），指令格式如下：
- 若更新已有属性：updateRow("表格名", {"属性名": "要修改的值"}) 或者特定定位 updateRow("表格名", {"查找列名": "查找值"}, {"要修改的列名": "新值"})
- 若新增属性/记录：insertRow("表格名", {"列1": "值1", "列2": "值2"})
- 若删除属性/记录：deleteRow("表格名", {"定位列": "值"})
指令示例（必须单独占行，置于你的回复文本最末尾）：
updateRow("好感关系表", {"好感度": "85", "当前关系": "心动"})

当前数据表格内容如下:
{{sheets_markdown}}
==================================`;

export const DEFAULT_LOCATION_REGEX = "\\[(?:Location|地点):\\s*(.*?)\\]";
export const DEFAULT_TIME_REGEX = "\\[(?:Time|时间):\\s*(.*?)\\]";
export const DEFAULT_CONDITION_REGEX = "\\[(?:Condition|状态|心境):\\s*(.*?)\\]";
export const DEFAULT_INVENTORY_REGEX = "\\[(?:Inventory|物品|道具):\\s*(.*?)\\]";
export const DEFAULT_BONDING_REGEX = "\\[(?:Bonding|羁绊|情感):\\s*(.*?)\\]";
