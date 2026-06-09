import type { ChatSession, CharacterCard, UserSettings } from "../src/types";

// ─── Shim Global Window, Document, and Location for Node.js (Vitals for jQuery/Vue) ───
globalThis.window = globalThis as any;
(globalThis as any).location = {
  href: "http://localhost/",
  protocol: "http:",
  host: "localhost",
};
(globalThis as any).document = {
  documentElement: {
    matches: () => false,
    style: {},
  },
  createElement: () => ({
    style: {},
    getElementsByTagName: () => [],
  }),
  getElementsByTagName: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
  location: (globalThis as any).location,
} as any;
(globalThis as any).z = {};

async function runTests() {
  // Dynamically import dependencies after shimming window and document
  // @ts-ignore
  const { initTavernHelperBridge, cleanTavernHelperBridge } = await import("./temp_bridge");

  console.log("=================================================");
  console.log("🚀 RUNNING BRIDGE CORE METHOD UNIT TESTS");
  console.log("=================================================");

  const mockCharacter: CharacterCard = {
    id: "char_1",
    name: "Yangzhou Dream",
    description: "Yangzhou character card",
    personality: "Poetic",
    scenario: "Yangzhou",
    first_mes: "Hello traveler",
    mes_example: "",
    system_prompt: "",
    lorebookEntries: [],
  };

  const mockSession: ChatSession = {
    id: "session_1",
    characterId: "char_1",
    title: "Test Session",
    createdAt: Date.now(),
    messages: [
      {
        id: "msg_1",
        sender: "assistant",
        content: "Greeting message",
        timestamp: Date.now(),
        extra: {
          variables: {
            0: { stat_data: { health: 100, name: "Traveler" } }
          }
        }
      } as any,
      {
        id: "msg_2",
        sender: "user",
        content: "Hello AI",
        timestamp: Date.now(),
        extra: {
          variables: {
            0: { stat_data: { health: 90, name: "Traveler" } }
          }
        }
      } as any,
    ],
    summaries: [],
    variables: { stat_data: { health: 90, name: "Traveler" } }
  };

  let sessionSaved: ChatSession | null = null;

  initTavernHelperBridge({
    activeCharacter: mockCharacter,
    activeSession: mockSession,
    setSessions: () => {},
    saveSession: async (session) => {
      sessionSaved = session;
    },
    setCharacters: () => {},
    saveCharacter: async () => {},
    settings: { userName: "Bob" } as UserSettings,
    updateSettings: () => {},
    handleSendMessage: async () => {},
  });

  const globalWin = globalThis as any;
  const TavernHelper = globalWin.TavernHelper;
  assert(!!TavernHelper, "TavernHelper exists on global window");
  
  const bind = TavernHelper._bind;
  assert(!!bind, "TavernHelper._bind exists");

  console.log("\n--- Testing resolveMessageId & variables getters ---");

  // A. Test index 0
  const vars0 = bind._getVariables({ type: "message", message_id: 0 });
  assert(vars0.stat_data.health === 100, "Get variables for index 0 matches");

  // B. Test index -1
  const varsMinus1 = bind._getVariables({ type: "message", message_id: -1 });
  assert(varsMinus1.stat_data.health === 90, "Get variables for index -1 resolves to last message");

  // C. Test 'latest' string
  const varsLatest = bind._getVariables({ type: "message", message_id: "latest" });
  assert(varsLatest.stat_data.health === 90, "Get variables for 'latest' resolves to last message");

  console.log("✔ Message ID resolution in getVariables verified successfully!");

  console.log("\n--- Testing SillyTavern and TavernHelper character APIs ---");

  const character = TavernHelper.getCharacter();
  assert(character !== null, "getCharacter returns non-null");
  assert(Array.isArray(character.alternate_greetings), "getCharacter returns alternate_greetings array");

  const context = globalWin.SillyTavern.getContext();
  assert(!!context.character, "getContext().character exists");
  assert(!!context.character.data, "getContext().character.data exists");
  assert(Array.isArray(context.character.data.alternate_greetings), "getContext().character.data.alternate_greetings is array");

  console.log("✔ Character V2 structures and alternate_greetings verified successfully!");

  console.log("\n--- Testing variables setters with negative/latest IDs ---");

  // D. Test _replaceVariables with message_id: -1
  sessionSaved = null;
  bind._replaceVariables({ stat_data: { health: 80, name: "Traveler" } }, { type: "message", message_id: -1 });
  assert(sessionSaved !== null, "Session is saved after replaceVariables");
  if (!sessionSaved) throw new Error("sessionSaved is null");
  const lastMsgExtra = sessionSaved.messages[1].extra;
  assert(lastMsgExtra?.variables?.[0]?.stat_data?.health === 80, "replaceVariables with index -1 updates the last message");

  // E. Test _setChatMessage with id: -1
  sessionSaved = null;
  bind._setChatMessage(-1, {
    variables: { stat_data: { health: 70, name: "Traveler" } }
  });
  assert(sessionSaved !== null, "Session is saved after setChatMessage");
  if (!sessionSaved) throw new Error("sessionSaved is null");
  const lastMsgExtra2 = sessionSaved.messages[1].extra;
  assert(lastMsgExtra2?.variables?.[0]?.stat_data?.health === 70, "setChatMessage with index -1 updates the last message variables");

  // F. Test TavernHelper.setChatMessages with message_id: -1
  sessionSaved = null;
  TavernHelper.setChatMessages([
    {
      message_id: -1,
      variables: { stat_data: { health: 60, name: "Traveler" } }
    }
  ]);
  assert(sessionSaved !== null, "Session is saved after setChatMessages");
  if (!sessionSaved) throw new Error("sessionSaved is null");
  const lastMsgExtra3 = sessionSaved.messages[1].extra;
  assert(lastMsgExtra3?.variables?.[0]?.stat_data?.health === 60, "setChatMessages with index -1 updates the last message variables");

  console.log("✔ Message ID resolution in variables setters verified successfully!");

  console.log("\n--- Testing unified event emitters ---");
  let eventFired = false;
  let eventArg: any = null;
  globalWin.SillyTavern.getContext().eventSource.on("test_unified_event", (arg: any) => {
    eventFired = true;
    eventArg = arg;
  });
  TavernHelper._bind._eventEmit("test_unified_event", "hello_event");
  assert(eventFired === true, "Unified event emitter propagated events correctly");
  assert(eventArg === "hello_event", "Unified event argument propagated correctly");
  console.log("✔ Unified event emitters verified successfully!");

  console.log("\n--- Testing session switch auto-notification triggers ---");
  let sessionChangedFired = false;
  let newSessionId: string | null = null;
  globalWin.SillyTavern.getContext().eventSource.on("chat_id_changed", (id: string) => {
    sessionChangedFired = true;
    newSessionId = id;
  });

  const nextSession: ChatSession = {
    id: "session_2",
    characterId: "char_1",
    title: "New Session",
    createdAt: Date.now(),
    messages: [
      { id: "msg_new", sender: "assistant", content: "New greeting", timestamp: Date.now() }
    ],
    summaries: [],
    variables: { stat_data: { health: 100 } }
  };

  // Trigger bridge initialization with the same first session (sets lastSessionId to session_1)
  initTavernHelperBridge({
    activeCharacter: mockCharacter,
    activeSession: mockSession,
    setSessions: () => {},
    saveSession: async () => {},
    setCharacters: () => {},
    saveCharacter: async () => {},
    settings: { userName: "Bob" } as UserSettings,
    updateSettings: () => {},
    handleSendMessage: async () => {},
  });

  // Switch session to nextSession, which should trigger the auto-notification trigger
  initTavernHelperBridge({
    activeCharacter: mockCharacter,
    activeSession: nextSession,
    setSessions: () => {},
    saveSession: async () => {},
    setCharacters: () => {},
    saveCharacter: async () => {},
    settings: { userName: "Bob" } as UserSettings,
    updateSettings: () => {},
    handleSendMessage: async () => {},
  });

  // Wait 100ms for the setTimeout in the trigger to fire
  await new Promise(resolve => setTimeout(resolve, 100));

  assert(sessionChangedFired === true, "Session switch auto-notification chat_id_changed event was fired");
  assert(newSessionId === "session_2", "Session switch auto-notification chat_id_changed parameter was correct");
  console.log("✔ Session switch auto-notification verified successfully!");

  cleanTavernHelperBridge();
  console.log("\n=================================================");
  console.log("🎉 ALL BRIDGE TESTS PASSED SUCCESSFULLY!");
  console.log("=================================================");
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

runTests().catch(err => {
  console.error("\n❌ TESTS FAILED!");
  console.error(err.stack || err.message);
  process.exit(1);
});
