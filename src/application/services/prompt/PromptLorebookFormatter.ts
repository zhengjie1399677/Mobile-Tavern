import type { LorebookEntry } from "../../../types";
import type { PromptMacroParams } from "./PromptMacroFormatter";

type PromptMacroReplacer = (text: string, params: PromptMacroParams) => string;

export function formatTriggeredLorebookEntries(
  entries: readonly LorebookEntry[],
  macroParams: PromptMacroParams,
  replaceMacros: PromptMacroReplacer,
  variables: Record<string, unknown>,
  worldInfoFormat?: string,
): string {
  return [...entries]
    .sort((left, right) => {
      const depthLeft = left.depth ?? 4;
      const depthRight = right.depth ?? 4;
      if (depthRight !== depthLeft) return depthRight - depthLeft;
      return (left.order ?? 100) - (right.order ?? 100);
    })
    .map((entry) => {
      const content = replaceMacros(entry.content, { ...macroParams, variables });
      // ST `wi_format` 用 {0} 承载条目正文；空模板等同于原样输出。
      const formatted = worldInfoFormat && worldInfoFormat.trim()
        ? worldInfoFormat.replace(/\{0\}/g, content)
        : content;
      return entry.addMemo && entry.comment
        ? `[设定及备注: ${entry.comment}]\n${formatted}`
        : formatted;
    })
    .join("\n\n");
}
