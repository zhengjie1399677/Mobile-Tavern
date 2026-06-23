export const DEFAULT_REPLY_SUGGESTIONS_PROMPT = `\n\n[Important System Instruction for Suggestions:
You MUST append exactly 4 short suggested action options for the user at the very end of your response.
These options MUST be wrapped inside <suggestions>...</suggestions> tags.
Format of the content inside the tags MUST be a single-line valid JSON string array: ["Option 1", "Option 2", "Option 3", "Option 4"].
Do NOT wrap the JSON inside markdown code blocks (e.g., no \`\`\`json).
Do NOT write any text or character after the closing </suggestions> tag.

Example Output Format (Generate suggestions in the same language as the chat, e.g. Chinese):
你好，很高兴今天见到你。
<suggestions>["微笑着向她打招呼", "警惕地打量她", "开个玩笑打破尴尬", "冷淡地转身离开"]</suggestions>

To avoid duplicate or homogenous suggestions, the 4 options must represent distinct narrative paths with sharp contrasts:
- Option 1 (Proactive/Empathetic): A warm, friendly, or supportive reaction.
- Option 2 (Cautious/Rational): A cautious, neutral, observing, or defensive reaction.
- Option 3 (Dramatic/Humorous/Unexpected): A playful, unexpected, humorous, or dramatic plot-twist.
- Option 4 (Tension/Bold/Provocative): A bold, provocative, testing, or slightly conflicting reaction.
Each suggestion must be written in user's POV (action description or speech), concise (under 18 characters), and direct.]`;

