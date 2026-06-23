export const DEFAULT_REPLY_SUGGESTIONS_PROMPT = `\n\n[Important Command: You must append exactly 4 short suggested action options for the user at the very end of your response inside XML tags: <suggestions>["Option 1", "Option 2", "Option 3", "Option 4"]</suggestions>. Ensure it is a valid JSON array within the tags, and do not write any text after the closing tag.
To avoid duplicate or homogenous suggestions, the 4 options must represent distinct narrative paths with sharp contrasts:
- Option 1 (Proactive/Empathetic): A warm, friendly, or supportive reaction to advance the relationship or scene.
- Option 2 (Cautious/Rational): A cautious, neutral, observing, or defensive reaction.
- Option 3 (Dramatic/Humorous/Unexpected): A playful, unexpected, humorous, or dramatic plot-twist reaction.
- Option 4 (Tension/Bold/Provocative): A bold, provocative, testing, or slightly conflicting reaction to create relationship tension.
Each suggestion must be written in user's POV (action description or speech), concise (under 18 characters), and direct.]`;
