import { PromptBuilder } from "../../src/kernel/services/prompt/PromptBuilder";
import { PromptCompiler } from "../../src/kernel/services/prompt/PromptCompiler";
import { PromptService } from "../../src/kernel/services/PromptService";
import { assert } from "./testUtils";
import type { RuntimeContext } from "../../src/kernel/services/prompt/types";
import type { IKernel } from "../../src/kernel/types";
import type { CharacterCard, ChatSession, UserSettings } from "../../src/types";

export function testPromptRuntime() {
  console.log("\n--- Running Prompt Runtime (Builder & Compiler v2.0) Verification ---");

  const builder = new PromptBuilder();

  // Test 1: Section Registration
  builder.registerSection({
    id: "rules",
    phase: "Engine",
    enabled: true,
    compile: () => ({
      id: "rules",
      phase: "Engine",
      type: "Instruction",
      priority: "High",
      mutable: false,
      title: "Core Rules",
      content: "Core Rules Content",
    }),
  });

  builder.registerSection({
    id: "safety",
    phase: "Engine",
    enabled: true,
    compile: () => ({
      id: "safety",
      phase: "Engine",
      type: "Instruction",
      priority: "Highest",
      mutable: false,
      title: "Safety",
      content: "Safety Content",
    }),
  });

  builder.registerSection({
    id: "persona",
    phase: "Context",
    enabled: true,
    compile: () => ({
      id: "persona",
      phase: "Context",
      type: "Context",
      priority: "High",
      mutable: false,
      title: "Persona",
      content: "Character Persona Content",
    }),
  });

  builder.registerSection({
    id: "disabled_section",
    phase: "Context",
    enabled: false,
    compile: () => ({
      id: "disabled_section",
      phase: "Context",
      type: "Context",
      priority: "Normal",
      mutable: true,
      title: "Disabled",
      content: "This should not appear",
    }),
  });

  builder.registerSection({
    id: "output_protocol",
    phase: "Protocol",
    enabled: true,
    compile: () => ({
      id: "output_protocol",
      phase: "Protocol",
      type: "Instruction",
      priority: "Highest",
      mutable: false,
      title: "Output Protocol",
      content: "Output Protocol Content",
    }),
  });

  const sections = builder.getSections();
  assert(sections.length === 5, "Should have 5 registered sections");

  // Test 2: Compiler Ordering and Headers
  const compiler = new PromptCompiler();
  const context = {
    settings: {
      api: { modelName: "deepseek-chat" },
    },
    enabledFeatures: {
      tableMemory: false,
      replySuggestions: false,
      memoryRecall: false,
    },
  } as unknown as RuntimeContext;

  const compiled = compiler.compile(sections, context);

  // Check Markdown headers are rendered correctly
  assert(compiled.includes('### Safety'), "Has safety Markdown header");
  assert(compiled.includes('### Core Rules'), "Has rules Markdown header");
  assert(compiled.includes('### Persona'), "Has persona Markdown header");
  assert(compiled.includes('### Output Protocol'), "Has output_protocol Markdown header");
  assert(!compiled.includes("disabled_section"), "Should not compile disabled section");

  // Check internal ordering: output_protocol (Highest) -> Safety (Highest) -> Rules (High) -> Persona (Context)
  const safetyIdx = compiled.indexOf("Safety Content");
  const rulesIdx = compiled.indexOf("Core Rules Content");
  const personaIdx = compiled.indexOf("Character Persona Content");
  const outputIdx = compiled.indexOf("Output Protocol Content");

  assert(outputIdx < safetyIdx, "Output Protocol should be before Safety due to alphabetical ID order");
  assert(safetyIdx < rulesIdx, "Safety should be before Rules");
  assert(rulesIdx < personaIdx, "Engine layer should be before Context layer");

  // Test 3: Rendering Format Override
  const mdContext = {
    settings: {
      api: { modelName: "deepseek-chat" },
      promptConfig: { renderingFormat: "markdown" }
    }
  } as unknown as RuntimeContext;
  const compiledMd = compiler.compile(sections, mdContext);
  assert(!compiledMd.includes("<rules>"), "Should not contain XML tags in Markdown renderingFormat");
  assert(compiledMd.includes("### Core Rules"), "Should contain Markdown headers");

  const xmlContext = {
    settings: {
      api: { modelName: "gpt-3.5-turbo" },
      promptConfig: { renderingFormat: "xml" }
    }
  } as unknown as RuntimeContext;
  const compiledXml = compiler.compile(sections, xmlContext);
  assert(compiledXml.includes("<rules>"), "Should contain XML tags when renderingFormat is overridden to xml");

  // Test 4: Dynamic contextLimit Trimming
  const smallLimitContext = {
    settings: {
      api: { modelName: "deepseek-chat", contextLimit: 50 },
    }
  } as unknown as RuntimeContext;
  const compiledSmall = compiler.compile(sections, smallLimitContext);
  assert(!compiledSmall.includes("Character Persona Content"), "Persona should be trimmed due to contextLimit");
  assert(compiledSmall.includes("Safety Content"), "Highest priority safety should still be present");

  console.log("✔ Prompt Runtime Builder & Compiler v2.0 verified!");
}

export function testPromptServiceIntegration() {
  console.log("\n--- Running Prompt Service Integration v2.0 Verification ---");

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
  } as unknown as IKernel;

  service.init(mockKernel);

  const character = {
    name: "Alice",
    description: "A friendly bartender.",
    personality: "Outgoing",
    scenario: "Bartending",
    system_prompt: "Talk like a bartender.",
    mes_example: "Hello, what can I get you?",
  } as unknown as CharacterCard;

  const chat = {
    messages: [
      { id: "1", sender: "user", content: "Hi" },
      { id: "2", sender: "assistant", content: "Hello!" }
    ],
    summaries: [
      { timeTag: "Day 1", location: "Tavern", content: "Alice met the traveler." }
    ],
    tableMemory: []
  } as unknown as ChatSession;

  const settings = {
    userName: "Bob",
    userInfo: "Traveler",
    api: {
      type: "openai-compat",
      baseUrl: "https://api.openai.com",
      apiKey: "key",
      modelName: "deepseek-chat",
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
  } as unknown as UserSettings;

  const result = service.assemblePrompt({
    character,
    chat,
    userInput: "I want a drink",
    settings,
    globalLorebook: [],
    recalledMemories: []
  });

  // Verify compiled Markdown structure
  assert(result.systemInstruction.includes('### Core Rules'), "Contains core_rules Markdown header");
  assert(result.systemInstruction.includes('### Character Persona'), "Contains char_persona Markdown header");
  assert(result.systemInstruction.includes('### Story Timeline Summary'), "Contains summary Markdown header");
  assert(result.systemInstruction.includes('### Jailbreak'), "Contains jailbreak Markdown header");

  // Verify specific contents are compiled in the right places
  assert(result.systemInstruction.includes("System rules."), "Contains mainPrompt");
  assert(result.systemInstruction.includes("A friendly bartender."), "Contains description");
  assert(result.systemInstruction.includes("Alice met the traveler."), "Contains summaries");
  assert(result.systemInstruction.includes("Jailbreak text."), "Contains jailbreak");

  // Verify that dialogue history is correctly returned
  assert(result.history.length === 2, "Should return 2 history messages");

  console.log("✔ Prompt Service integration with Prompt Runtime v2.0 verified!");
}
