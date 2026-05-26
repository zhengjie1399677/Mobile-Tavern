const fs = require("fs");

let appContent = fs.readFileSync("src/App.tsx", "utf8");
appContent = appContent.replace(/const DEFAULT_PRESETS/g, "export const DEFAULT_PRESETS");
appContent = appContent.replace(/const DEFAULT_PROMPT_CONFIG/g, "export const DEFAULT_PROMPT_CONFIG");
appContent = appContent.replace(/const DEFAULT_SETTINGS/g, "export const DEFAULT_SETTINGS");
fs.writeFileSync("src/App.tsx", appContent);

const tabs = ["CharactersTab", "ChatHistoryTab", "ChatTab", "GlobalWorldbookTab", "SettingsTab"];

tabs.forEach(tab => {
  let content = fs.readFileSync("src/tabs/" + tab + ".tsx", "utf8");
  
  content = content.replace(/\.\.\/components\/ui/g, "../../components/ui");
  
  const staticImports = "\nimport { CharacterCard, ChatSession, UserSettings, LorebookEntry, Message, SummaryCard, ApiConfig, SamplerPreset, MemoryConfig, PromptConfig } from \"../types\";\nimport { getAllCharacters, saveCharacter, deleteCharacter, getAllSessions, saveSession, deleteSession, getStoredSettings, saveStoredSettings, getGlobalLorebook, saveGlobalLorebook } from \"../utils/localDB\";\nimport { parseCharacterFile, injectPngMetadata, encryptBackupData, decryptBackupData } from \"../utils/cardParser\";\nimport { assemblePromptContext } from \"../utils/promptBuilder\";\nimport { DEFAULT_PRESETS, DEFAULT_PROMPT_CONFIG, DEFAULT_SETTINGS } from \"../App\";\n";
  
  content = content.replace(/from "lucide-react";/, 'from "lucide-react";' + staticImports);
  
  fs.writeFileSync("src/tabs/" + tab + ".tsx", content);
});
