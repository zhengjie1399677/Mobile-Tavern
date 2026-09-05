import { expect, it, vi } from "vitest";
import { createKernel } from "../../src/kernel/Kernel";
import { CompatibilityRuntimeService } from "../../src/application/services/CompatibilityRuntimeService";
import { PromptService } from "../../src/application/services/PromptService";
import { resolveSillyTavernWorldInfoState } from "../../src/application/runtimePlugins/sillyTavernCompatibilityRuntimePlugin";
import { SILLY_TAVERN_COMPATIBILITY_PLUGIN_ID as pluginId } from "../../src/application/compatibility/contracts";
import { assembleAuthoritativePromptEnvelope, applyPromptRuntimeState, type AssemblePromptEnvelopeParams } from "../../src/application/useCases/assemblePromptEnvelopeUseCase";
import { DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import type { CharacterCard, ChatSession, Message } from "../../src/types";

it("世界书时效通过生成包提交，预览不改会话，分页后仍使用绝对位置", async () => {
  const kernel = createKernel();
  const runtime = new CompatibilityRuntimeService();
  await kernel.registerService(runtime.name, runtime);
  runtime.registerWorldInfoResolver({ id: "compat.test.world-info", version: "1.0.0", resolve: resolveSillyTavernWorldInfoState });
  const promptService = new PromptService();
  promptService.init(kernel);
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.promptConfig.usePromptComposition = true;
  settings.promptConfig.composition = { id: "world", name: "世界书", version: 1, blocks: [{
    id: "world", name: "世界书", role: "system", enabled: true, order: 1, placement: { type: "ordered" },
    source: { type: "template" }, template: "{{worldbook.triggered}}",
  }] };
  const character = { id: "char", name: "角色", lorebookEntries: [{ id: "effect", keys: ["触发"], content: "持续设定", enabled: true, constant: false, sticky: 3 }] } as CharacterCard;
  const message: Message = { id: "last", sender: "user", content: "触发", timestamp: 0, turnIndex: 20 };
  const session: ChatSession = { id: "session", characterId: "char", title: "测试", createdAt: 0, summaries: [], messages: [message] };
  const databaseService = { getSessionPromptMessages: vi.fn(async () => [message]) } as unknown as AssemblePromptEnvelopeParams["databaseService"];
  const prepared = await assembleAuthoritativePromptEnvelope({ databaseService, promptService, character, session, userInput: "触发", settings, globalLorebook: [] });
  expect(session.runtimePluginState).toBeUndefined();
  expect(prepared.promptEnvelope.runtimePluginStatePatch?.[pluginId]).toMatchObject({ timedWorldInfo: { sticky: { effect: { start: 21, end: 24 } } } });
  const committed = applyPromptRuntimeState({ ...session, runtimePluginState: { [pluginId]: { userValue: 42 } } }, prepared.promptEnvelope.runtimePluginStatePatch);
  expect(committed.runtimePluginState?.[pluginId]).toMatchObject({ userValue: 42 });
  const next = { ...committed, messages: [{ ...message, content: "没有关键字", turnIndex: 22 }] };
  const preview = promptService.assemblePrompt({ character, chat: next, userInput: "继续", settings });
  expect(preview.messages.map(item => item.content).join()).toContain("持续设定");
  expect(next.runtimePluginState).toEqual(committed.runtimePluginState);
  const expired = promptService.assemblePrompt({ character, chat: { ...next, messages: [{ ...next.messages[0], turnIndex: 24 }] }, userInput: "继续", settings });
  expect(expired.messages.map(item => item.content).join()).not.toContain("持续设定");
  await kernel.destroy();
});
