import type { CompatibilityCodecDefinition } from "../../src/application/compatibility/contracts";
import { parsePromptComposition } from "../../src/domain/prompt-composition";
import {
  analyzeSillyTavernPreset,
  exportSillyTavernComposition,
  importSillyTavernPreset,
} from "../../src/infrastructure/compat/sillytavern";

export const testSillyTavernCompatibilityCodec: CompatibilityCodecDefinition = {
  id: "compat.test.sillytavern-prompt-preset",
  version: "1.0.0",
  format: "sillytavern.prompt-preset",
  canDecode(input) {
    return analyzeSillyTavernPreset(input).level !== "invalid";
  },
  analyze: analyzeSillyTavernPreset,
  decode: importSillyTavernPreset,
  encode(input) {
    return exportSillyTavernComposition(parsePromptComposition(input));
  },
};
