import {
  replaceMacros,
  getTriggeredLorebookEntries,
  assemblePromptContext,
} from "../src/utils/promptBuilder";
import { CharacterCard, ChatSession, UserSettings, LorebookEntry, Message } from "../src/types";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function testReplaceMacros() {
  console.log("-> Running replaceMacros tests...");

  const params = {
    char: "Alice",
    user: "Bob",
    description: "A helpful AI assistant that costs $10.",
    personality: "Cheerfully optimistic.",
    scenario: "In a cozy tavern with $20 cash.",
    userPersona: "A curious traveler.",
    mes_example: "Hello!",
  };

  // 1. Standard replacement
  const t1 = "Hello, {{user}}! I am {{char}}.";
  assert(replaceMacros(t1, params) === "Hello, Bob! I am Alice.", "Standard replacement");

  // 2. Case-insensitivity replacement
  const t2 = "Hello, {{USER}}! I am {{CHAR_NAME}}.";
  assert(replaceMacros(t2, params) === "Hello, Bob! I am Alice.", "Case-insensitivity replacement");

  // 3. String containing $ symbols (tests regex collapse protection)
  const t3 = "Your profile: {{description}} Scenario: {{scenario}}";
  const expectedT3 = "Your profile: A helpful AI assistant that costs $10. Scenario: In a cozy tavern with $20 cash.";
  assert(replaceMacros(t3, params) === expectedT3, "Regex collapse protection with $ symbols");

  // 4. Undefined keys are ignored
  const t4 = "Some {{unknown_macro}} here.";
  assert(replaceMacros(t4, params) === "Some {{unknown_macro}} here.", "Unknown macros ignored");

  console.log("✔ replaceMacros tests passed!");
}

function testLorebookTriggers() {
  console.log("-> Running getTriggeredLorebookEntries tests...");

  const baseEntries: LorebookEntry[] = [
    {
      id: "lore_constant",
      keys: ["always"],
      content: "Constant lore info",
      constant: true,
      enabled: true,
    },
    {
      id: "lore_simple",
      keys: ["sword", "blade"],
      content: "A legendary sword forged in fire.",
      enabled: true,
      scanDepth: 10,
    },
    {
      id: "lore_regex",
      keys: ["/dragon[s]?/i"],
      content: "Dragons are mythical flying beasts.",
      enabled: true,
      useRegex: true,
      scanDepth: 10,
    },
    {
      id: "lore_selective_and",
      keys: ["wizard"],
      secondary_keys: ["spell", "wand"],
      selectiveLogic: "AND_ANY",
      content: "Wizards use spells and wands to cast magic.",
      enabled: true,
      scanDepth: 10,
    },
    {
      id: "lore_selective_not",
      keys: ["shield"],
      secondary_keys: ["broken"],
      selectiveLogic: "NOT_ANY",
      content: "This shield is unbreakable.",
      enabled: true,
      scanDepth: 10,
    },
    {
      id: "lore_depth_limit",
      keys: ["potion"],
      content: "Potions heal wounds.",
      enabled: true,
      scanDepth: 2, // only scans last 2 messages (+ user input)
    },
  ];

  const messages: Message[] = [
    { id: "m1", sender: "user", content: "We found a potion in the dungeon." }, // 4 messages ago
    { id: "m2", sender: "assistant", content: "A wizard approached us." },
    { id: "m3", sender: "user", content: "He cast a spell." },
    { id: "m4", sender: "assistant", content: "It matched his dragon shield." },
  ];

  // Test Case 1: User input "I swing my sword at the dragons."
  // Should trigger: lore_constant (constant), lore_simple ("sword"), lore_regex ("dragons"), lore_selective_not ("shield" present, but "broken" NOT present in history)
  // Should NOT trigger: lore_depth_limit ("potion" is at m1 which is beyond depth 2)
  const active1 = getTriggeredLorebookEntries(messages, "I swing my sword at the dragons.", baseEntries);
  const activeIds1 = active1.map(e => e.id);
  
  assert(activeIds1.includes("lore_constant"), "Constant triggers");
  assert(activeIds1.includes("lore_simple"), "Simple keyword match");
  assert(activeIds1.includes("lore_regex"), "Regex keyword match");
  assert(activeIds1.includes("lore_selective_not"), "Selective NOT logic match");
  assert(!activeIds1.includes("lore_depth_limit"), "Depth limit constraints work");

  // Test Case 2: User input "The shield was broken."
  // Should NOT trigger lore_selective_not because "broken" is now present
  const active2 = getTriggeredLorebookEntries(messages, "The shield was broken.", baseEntries);
  const activeIds2 = active2.map(e => e.id);
  assert(!activeIds2.includes("lore_selective_not"), "Selective NOT logic block");

  // Test Case 3: User input "potion" -> should trigger depth limit now because it is in user input
  const active3 = getTriggeredLorebookEntries(messages, "I drank a potion.", baseEntries);
  const activeIds3 = active3.map(e => e.id);
  assert(activeIds3.includes("lore_depth_limit"), "Depth limit triggered by user input");

  console.log("✔ getTriggeredLorebookEntries tests passed!");
}

function runAll() {
  console.log("=== Running Mobile Tavern Functional Test Suite ===");
  try {
    testReplaceMacros();
    testLorebookTriggers();
    console.log("🎉 All tests passed successfully!");
  } catch (err: any) {
    console.error("❌ Test failed:", err.message);
    process.exit(1);
  }
}

runAll();
