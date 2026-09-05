import { expect, it } from "vitest";
import { createKernel } from "../../src/kernel/Kernel";
import { CompatibilityRuntimeService } from "../../src/application/services/CompatibilityRuntimeService";
import { PromptService } from "../../src/application/services/PromptService";
import { applySillyTavernRegexScripts } from "../../src/compatibility/sillytavern/mvuParser";
import { DEFAULT_SETTINGS } from "../../src/defaults/settings";
import type { CharacterCard, ChatSession } from "../../src/types";

it.each([false, true])("传统 Prompt 在 roleplayMode=%s 时按历史深度筛选正则", async roleplayMode => {
  const kernel = createKernel();
  const runtime = new CompatibilityRuntimeService();
  await kernel.registerService(runtime.name, runtime);
  runtime.registerTransform({ id: "test.regex", version: "1.0.0", transform: request =>
    applySillyTavernRegexScripts(request.text, request.character, request.isAiMessage, request.charName, request.userName, "prompt", request.signal, { presetRegexScripts: request.presetRegexScripts, depth: request.depth }) });
  const prompt = new PromptService();
  prompt.init(kernel);
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.promptConfig.usePromptComposition = false;
  settings.promptConfig.roleplayMode = roleplayMode;
  settings.presetRegexScripts = [{ id: "recent", scriptName: "最近一条", findRegex: "TOKEN", replaceString: "RECENT", disabled: false, placement: [1, 2], promptOnly: true, minDepth: 0, maxDepth: 0 }];
  const character = { id: "char", name: "角色", extensions: {} } as CharacterCard;
  const chat: ChatSession = { id: "chat", title: "测试", characterId: "char", createdAt: 0, summaries: [], messages: [
    { id: "a", sender: "assistant", content: "OLD_TOKEN", timestamp: 0 },
    { id: "b", sender: "user", content: "NEW_TOKEN", timestamp: 1 },
  ] };
  const result = prompt.assemblePrompt({ character, chat, settings, userInput: "继续" });
  const text = result.messages.map(item => item.content).join("\n");
  expect(text).toContain("OLD_TOKEN");
  expect(text).toContain("NEW_RECENT");
  await kernel.destroy();
});
