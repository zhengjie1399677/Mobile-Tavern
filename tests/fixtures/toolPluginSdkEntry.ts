import {
  defineToolPluginHandlers,
  registerToolPlugin,
} from "../../sdk/tool-plugin/src";

registerToolPlugin(defineToolPluginHandlers({
  echo: async (input: { readonly value: string }) => ({ value: input.value }),
}));
