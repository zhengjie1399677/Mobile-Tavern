/** Prompt 发送前使用的纯文本规范化工具。 */
export function cleanPromptNameForApi(name: string | undefined, fallback: string): string | undefined {
  if (!name) return undefined;
  const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, "");
  return cleaned ? cleaned.slice(0, 64) : fallback;
}

export function estimatePromptTokens(text: string): number {
  if (!text) return 0;
  let asciiCount = 0;
  let nonAsciiCount = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) <= 127) asciiCount += 1;
    else nonAsciiCount += 1;
  }
  return Math.ceil(asciiCount * 0.25 + nonAsciiCount * 2.0);
}

export function sanitizePromptName(name: string): string {
  if (!name) return "";
  const sanitized = name
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/^[^a-zA-Z0-9_-]+/, "")
    .slice(0, 64);
  return /^[a-zA-Z0-9_-]+$/.test(sanitized) ? sanitized : "";
}
