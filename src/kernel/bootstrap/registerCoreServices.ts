import type { IKernel } from "../types";
import { KernelServices } from "../types";
import { DatabaseService } from "../services/DatabaseService";
import { LLMService } from "../services/LLMService";
import { PromptService } from "../services/PromptService";
import { TelemetryService } from "../services/TelemetryService";
import { ScriptService } from "../services/ScriptService";
import { MultiMessageService } from "../services/MultiMessageService";
import { ChatStreamService } from "../services/ChatStreamService";
import { UpdateCheckService } from "../services/UpdateCheckService";
import { MemoryService } from "../services/memory";
import { ImageGenerationService } from "../services/ImageGenerationService";
import { BgmService } from "../services/BgmService";
import { TtsService } from "../services/TtsService";
import { AsrService } from "../services/AsrService";
import { CharacterService } from "../services/CharacterService";
import { WorldbookService } from "../services/WorldbookService";
import { SettingsService } from "../services/SettingsService";
import { PresetService } from "../services/PresetService";

/** 注册运行内核所需的官方服务；不包含 UI 或 React 依赖。 */
export async function registerCoreServices(kernel: IKernel): Promise<void> {
  await kernel.registerServiceBatch([
    { name: KernelServices.Database, service: new DatabaseService(), initTimeoutMs: 5000 },
    { name: KernelServices.LLM, service: new LLMService(), initTimeoutMs: 8000 },
    { name: KernelServices.Prompt, service: new PromptService(), initTimeoutMs: 3000 },
    { name: KernelServices.Telemetry, service: new TelemetryService(), initTimeoutMs: 3000 },
    { name: KernelServices.Script, service: new ScriptService(), initTimeoutMs: 3000 },
    { name: KernelServices.MultiMessage, service: new MultiMessageService(), initTimeoutMs: 3000 },
    { name: KernelServices.ChatStream, service: new ChatStreamService(), initTimeoutMs: 5000 },
    { name: KernelServices.UpdateCheck, service: new UpdateCheckService() },
    { name: KernelServices.Memory, service: new MemoryService(), initTimeoutMs: 5000 },
    { name: KernelServices.ImageGen, service: new ImageGenerationService(), initTimeoutMs: 3000 },
    { name: KernelServices.Bgm, service: new BgmService(), initTimeoutMs: 3000 },
    { name: KernelServices.Tts, service: new TtsService(), initTimeoutMs: 3000 },
    { name: KernelServices.Asr, service: new AsrService(), initTimeoutMs: 3000 },
    { name: KernelServices.Character, service: new CharacterService(), initTimeoutMs: 3000 },
    { name: KernelServices.Worldbook, service: new WorldbookService(), initTimeoutMs: 3000 },
    { name: KernelServices.Settings, service: new SettingsService(), initTimeoutMs: 3000 },
    { name: KernelServices.Preset, service: new PresetService(), initTimeoutMs: 3000 },
  ]);
}
