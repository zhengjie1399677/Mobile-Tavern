import type { CompatibilityCodecDefinition } from "../../src/application/compatibility/contracts";
import { sillyTavernPromptPresetCodec } from "../../src/infrastructure/compat/sillytavern";

// 夹具只覆盖身份标识：来源语义与容器 wiring 必须与运行时同一份，
// 避免测试用 Codec 自行拼装后与生产 Codec 漂移。
export const testSillyTavernCompatibilityCodec: CompatibilityCodecDefinition = {
  ...sillyTavernPromptPresetCodec,
  id: "compat.test.sillytavern-prompt-preset",
};
