import {
  defineToolPluginHandlers,
  registerToolPlugin,
} from "../../../sdk/tool-plugin/src";

interface TextInput {
  readonly text: string;
}

export const textToolkitHandlers = defineToolPluginHandlers({
  textStats: ({ text }: TextInput) => {
    const trimmed = text.trim();
    return {
      characters: [...text].length,
      words: trimmed ? trimmed.split(/\s+/u).length : 0,
      lines: text ? text.split(/\r\n?|\n/u).length : 0,
    };
  },
  normalizeWhitespace: ({ text }: TextInput) => ({
    text: text
      .replace(/\r\n?/gu, "\n")
      .split("\n")
      .map((line) => line.replace(/[\t ]+$/gu, ""))
      .join("\n")
      .replace(/\n{3,}/gu, "\n\n"),
  }),
});

registerToolPlugin(textToolkitHandlers);
