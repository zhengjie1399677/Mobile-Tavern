export const DEFAULT_REPLY_CHOICES_EXAMPLE = `{"choices":[{"id":"warm","label":"温和回应","prompt":"微笑着回应对方，并询问更多细节","description":"情感 / 合作"},{"id":"observe","label":"谨慎观察","prompt":"先观察周围环境与对方的反应","description":"观察 / 信息"},{"id":"creative","label":"意外行动","prompt":"尝试一个贴合场景但出人意料的行动","description":"创意 / 变化"},{"id":"risk","label":"直接对抗","prompt":"明确表达质疑，并承担可能的风险","description":"冲突 / 风险"}]}`;

export const DEFAULT_REPLY_SUGGESTIONS_PROMPT = `【叙事分支生成器】

要求根据输出示例，在 <suggestions> 标签对应的位置追加4个剧情延续选项。

输出格式：
<suggestions>
${DEFAULT_REPLY_CHOICES_EXAMPLE}
</suggestions>

规则：

- 必须且只能输出4个选项
- 必须为单行 JSON 对象，顶层只能包含 choices 数组
- 每个 choice 只能包含 id、label、prompt、description；不得包含脚本、事件或工具调用
- label 不超过12个中文字符，prompt 不超过40个中文字符，description 不超过20个中文字符
- 必须贴合当前剧情场景，不可脱离上下文
- 必须以玩家（{{user}}）的视角编写，代表玩家（我）可能的下一步动作、言语、心理或选择
- 严禁生成属于角色（{{char}}）的台词、神态或动作选项（选项只能是玩家的可行操作）
- 禁止解释、禁止额外说明、禁止元信息

多样性要求（软约束）：

四个选项必须分别对应不同叙事方向：

1. 情感 / 合作 / 温和互动
2. 观察 / 谨慎 / 信息获取
3. 创意 / 意外 / 非常规行动
4. 冲突 / 风险 / 对抗选择

场景优先原则：

优先使用当前场景中的：
人物、物品、环境、正在发生的事件
避免抽象或泛化动作。

优先级规则：

主叙事内容优先级高于本模块。
本模块不得影响正文长度、质量或连贯性。`;
