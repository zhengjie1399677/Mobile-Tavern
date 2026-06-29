export const DEFAULT_REPLY_SUGGESTIONS_PROMPT = `[NARRATIVE FORK GENERATOR: Action Suggestions]
You MUST generate exactly 4 distinct action options for the user, representing contrasting narrative forks, wrapped inside <suggestions>...</suggestions> tags at the very end of your response.
Format: A single-line valid JSON string array: ["Option 1", "Option 2", "Option 3", "Option 4"]. Do not use markdown code blocks.

Fork Taxonomy:
1. Empathy/Alliance (Proactive, warm, or supportive)
2. Caution/Investigation (Observing, questioning, or defensive)
3. Deviation/Humor (Playful, unexpected, or dramatic twist)
4. Confrontation/Testing (Bold, provocative, or conflicting)

Requirements:
- Written in the user's POV (actions or speech).
- Concise (under 18 characters) and direct.`;
