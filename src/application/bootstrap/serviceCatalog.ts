import type { EffectDisposer, IKernel, IKernelService } from "../serviceContracts";
import { KernelServices } from "../serviceContracts";
import { MEMORY_PERSISTENCE_SERVICE } from "../services/memory/types";

export interface ServiceModuleDescriptor {
  name: string;
  initTimeoutMs?: number;
  load: () => Promise<IKernelService>;
}

/** 官方服务的声明式动态装载目录；新增服务无需再向装配函数添加静态 import。 */
export const coreServiceCatalog: readonly ServiceModuleDescriptor[] = [
  { name: KernelServices.Database, initTimeoutMs: 5000, load: async () => new (await import("../services/DatabaseService")).DatabaseService() },
  { name: KernelServices.LLM, initTimeoutMs: 8000, load: async () => new (await import("../services/LLMService")).LLMService() },
  { name: KernelServices.Prompt, initTimeoutMs: 3000, load: async () => new (await import("../services/PromptService")).PromptService() },
  { name: KernelServices.Telemetry, initTimeoutMs: 3000, load: async () => new (await import("../services/TelemetryService")).TelemetryService() },
  { name: KernelServices.Script, initTimeoutMs: 3000, load: async () => new (await import("../services/ScriptService")).ScriptService() },
  { name: KernelServices.MultiMessage, initTimeoutMs: 3000, load: async () => new (await import("../services/MultiMessageService")).MultiMessageService() },
  { name: KernelServices.ChatStream, initTimeoutMs: 5000, load: async () => new (await import("../services/ChatStreamService")).ChatStreamService() },
  { name: KernelServices.UpdateCheck, load: async () => new (await import("../services/UpdateCheckService")).UpdateCheckService() },
  { name: MEMORY_PERSISTENCE_SERVICE, initTimeoutMs: 5000, load: async () => new (await import("../../infrastructure/storage/IndexedDbMemoryPersistenceService")).IndexedDbMemoryPersistenceService() },
  { name: KernelServices.Memory, initTimeoutMs: 5000, load: async () => new (await import("../services/memory")).MemoryService() },
  { name: KernelServices.ImageGen, initTimeoutMs: 3000, load: async () => new (await import("../services/ImageGenerationService")).ImageGenerationService() },
  { name: KernelServices.Bgm, initTimeoutMs: 3000, load: async () => new (await import("../services/BgmService")).BgmService() },
  { name: KernelServices.Tts, initTimeoutMs: 3000, load: async () => new (await import("../services/TtsService")).TtsService() },
  { name: KernelServices.Asr, initTimeoutMs: 3000, load: async () => new (await import("../services/AsrService")).AsrService() },
  { name: KernelServices.Character, initTimeoutMs: 3000, load: async () => new (await import("../services/CharacterService")).CharacterService() },
  { name: KernelServices.Worldbook, initTimeoutMs: 3000, load: async () => new (await import("../services/WorldbookService")).WorldbookService() },
  { name: KernelServices.Settings, initTimeoutMs: 3000, load: async () => new (await import("../services/SettingsService")).SettingsService() },
  { name: KernelServices.Preset, initTimeoutMs: 3000, load: async () => new (await import("../services/PresetService")).PresetService() },
  { name: KernelServices.CharacterRender, initTimeoutMs: 3000, load: async () => new (await import("../services/CharacterRenderService")).CharacterRenderService() },
  { name: KernelServices.WorkerPlugins, initTimeoutMs: 3000, load: async () => new (await import("../services/WorkerPluginService")).WorkerPluginService() },
  { name: KernelServices.DataMigration, initTimeoutMs: 5000, load: async () => new (await import("../services/DataMigrationService")).DataMigrationService() },
  { name: KernelServices.LocalResources, initTimeoutMs: 5000, load: async () => new (await import("../services/LocalResourceService")).LocalResourceService() },
  { name: KernelServices.ThemeInteractions, initTimeoutMs: 3000, load: async () => new (await import("../services/ThemeInteractionService")).ThemeInteractionService() },
];

export async function loadServiceModules(
  catalog: readonly ServiceModuleDescriptor[],
): Promise<Array<{ name: string; service: IKernelService; initTimeoutMs?: number }>> {
  const entries = await Promise.all(catalog.map(async ({ load, ...descriptor }) => ({
    ...descriptor,
    service: await load(),
  })));
  const names = new Set<string>();
  for (const entry of entries) {
    if (names.has(entry.name)) throw new Error(`Duplicate service descriptor: ${entry.name}`);
    if (entry.service.name !== entry.name) {
      throw new Error(`Service descriptor mismatch: expected "${entry.name}", got "${entry.service.name}"`);
    }
    names.add(entry.name);
  }
  return entries;
}

/** 装载一组受信服务模块；卸载时按服务名调用 `kernel.destroyService()`。 */
export async function registerServiceModules(
  kernel: IKernel,
  catalog: readonly ServiceModuleDescriptor[],
): Promise<EffectDisposer> {
  return kernel.registerServiceBatch(await loadServiceModules(catalog));
}
