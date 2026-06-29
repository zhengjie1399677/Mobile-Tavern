import { PromptBuilder } from "../../src/kernel/services/prompt/PromptBuilder";
import { PromptCompiler } from "../../src/kernel/services/prompt/PromptCompiler";
import { PromptService } from "../../src/kernel/services/PromptService";
import { assert } from "./testUtils";

export function testPromptRuntime() {
  console.log("\n--- Running Prompt Runtime (Builder & Compiler) Verification ---");

  const builder = new PromptBuilder();

  // Test 1: Section Registration
  builder.registerSection({
    id: "rules",
    type: "engine",
    order: 2,
    enabled: true,
    compile: () => "Core Rules Content",
  });

  builder.registerSection({
    id: "safety",
    type: "engine",
    order: 1,
    enabled: true,
    compile: () => "Safety Content",
  });

  builder.registerSection({
    id: "persona",
    type: "character",
    order: 1,
    enabled: true,
    compile: () => "Character Persona Content",
  });

  builder.registerSection({
    id: "disabled_section",
    type: "context",
    order: 1,
    enabled: false,
    compile: () => "This should not appear",
  });

  builder.registerSection({
    id: "output_protocol",
    type: "output",
    order: 1,
    enabled: true,
    compile: () => "Output Protocol Content",
  });

  const sections = builder.getSections();
  assert(sections.length === 5, "Should have 5 registered sections");

  // Test 2: Compiler Ordering and Headers
  const compiler = new PromptCompiler();
  const compiled = compiler.compile(sections, {});

  assert(compiled.includes("==================================================\nENGINE\n=================================================="), "Has ENGINE header");
  assert(compiled.includes("==================================================\nCHARACTER\n=================================================="), "Has CHARACTER header");
  assert(compiled.includes("==================================================\nOUTPUT PROTOCOL\n=================================================="), "Has OUTPUT PROTOCOL header");
  assert(!compiled.includes("CONTEXT"), "Should not have CONTEXT header");
  assert(!compiled.includes("STYLE"), "Should not have STYLE header");

  // Check internal ordering
  const safetyIdx = compiled.indexOf("Safety Content");
  const rulesIdx = compiled.indexOf("Core Rules Content");
  const personaIdx = compiled.indexOf("Character Persona Content");
  const outputIdx = compiled.indexOf("Output Protocol Content");

  assert(safetyIdx < rulesIdx, "Safety (order 1) should be compiled before Rules (order 2)");
  assert(rulesIdx < personaIdx, "Engine sections should be compiled before Character sections");
  assert(personaIdx < outputIdx, "Character sections should be compiled before Output sections");

  console.log("✔ Prompt Runtime Builder & Compiler verified!");
}

export function testPromptServiceIntegration() {
  console.log("\n--- Running Prompt Service Integration Verification ---");

  const service = new PromptService();
  const mockKernel = {
    getService: (name: string) => {
      if (name === "memory") {
        return {
          getStateTable: () => ({
            initDefaultSheets: () => []
          })
        };
      }
      return null;
    }
  } as any;

  service.init(mockKernel);

  const character = {
    name: "Alice",
    description: "A friendly bartender.",
    personality: "Outgoing",
    scenario: "Bartending",
    system_prompt: "Talk like a bartender.",
    mes_example: "Hello, what can I get you?",
  } as any;

  const chat = {
    messages: [
      { id: "1", sender: "user", content: "Hi" },
      { id: "2", sender: "assistant", content: "Hello!" }
    ],
    summaries: [
      { timeTag: "Day 1", location: "Tavern", content: "Alice met the traveler." }
    ],
    tableMemory: []
  } as any;

  const settings = {
    userName: "Bob",
    userInfo: "Traveler",
    api: {
      type: "openai-compat",
      baseUrl: "https://api.openai.com",
      apiKey: "key",
      modelName: "gpt-4",
    },
    memory: {
      recentTurns: 5,
    },
    promptConfig: {
      roleplayMode: true,
      mainPrompt: "System rules.",
      useJailbreak: true,
      jailbreakPrompt: "Jailbreak text.",
    },
    enableTableMemory: false,
    enableReplySuggestions: false,
  } as any;

  const result = service.assemblePrompt({
    character,
    chat,
    userInput: "I want a drink",
    settings,
    globalLorebook: [],
    recalledMemories: []
  });

  console.log("=== DEBUG SYSTEM PROMPT ===\n", result.systemInstruction, "\n===========================");

  assert(result.systemInstruction.includes("=================================================="), "Should contain category dividers");
  assert(result.systemInstruction.includes("ENGINE"), "Should contain ENGINE category");
  assert(result.systemInstruction.includes("CHARACTER"), "Should contain CHARACTER category");
  assert(result.systemInstruction.includes("CONTEXT"), "Should contain CONTEXT category");
  assert(result.systemInstruction.includes("OUTPUT PROTOCOL"), "Should contain OUTPUT PROTOCOL category");

  assert(result.systemInstruction.includes("System rules."), "Contains mainPrompt");
  assert(result.systemInstruction.includes("A friendly bartender."), "Contains description");
  assert(result.systemInstruction.includes("Alice met the traveler."), "Contains summaries");
  assert(result.systemInstruction.includes("Jailbreak text."), "Contains jailbreak");

  assert(result.history.length === 2, "Should return 2 history messages");

  console.log("✔ Prompt Service integration with Prompt Runtime verified!");
}
