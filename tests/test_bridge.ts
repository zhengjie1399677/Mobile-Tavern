import { initTavernHelperBridge, cleanTavernHelperBridge } from "../src/utils/tavernHelper";
import { ChatSession, CharacterCard, UserSettings } from "../src/types";

/**
 * 测试专用 Mock 类型定义。
 * 这些类型仅在本测试文件内用于替代 `as any`，确保类型安全的同时保持运行时行为不变。
 */
interface TavernHelperBind {
  _getVariables: (params: { type: string; message_id: number | string }) => { stat_data: Record<string, unknown> };
  _replaceVariables: (vars: Record<string, unknown>, params: { type: string; message_id: number | string }) => void;
  _setChatMessage: (id: number, value: { variables: Record<string, unknown> }) => void;
}

interface TavernHelperGlobal {
  _bind: TavernHelperBind;
  setChatMessages: (messages: Array<{ message_id: number; variables: Record<string, unknown> }>) => void;
}

interface GlobalWithTavernHelper {
  TavernHelper: TavernHelperGlobal;
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log("=================================================");
  console.log("🚀 STARTING TAVERNHELPER BRIDGE UNIT TESTS");
  console.log("=================================================");

  // 1. Mock session and characters
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
      },
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
      },
    ],
    summaries: [],
    variables: { stat_data: { health: 90, name: "Traveler" } }
  };

  let sessionSaved: ChatSession | null = null;

  // Initialize bridge with mock state handlers
  initTavernHelperBridge({
    activeCharacter: null,
    activeSession: mockSession,
    setSessions: (updater: any) => {
      if (typeof updater === 'function') {
        updater([mockSession]);
      }
    },
    saveSession: async (session) => {
      sessionSaved = session;
    },
    setCharacters: () => {},
    saveCharacter: async () => {},
    settings: { userName: "Bob" } as UserSettings,
    updateSettings: () => {},
    handleSendMessage: async () => {},
  });

  // Access the parent window Mock properties exposed by the module
  const globalWin = globalThis as unknown as GlobalWithTavernHelper;
  const TavernHelper = globalWin.TavernHelper;
  assert(!!TavernHelper, "TavernHelper exists on global window");
  
  const bind = TavernHelper._bind;
  assert(!!bind, "TavernHelper._bind exists");

  console.log("\n--- Testing resolveMessageId & variables getters ---");

  // A. Test active swipe variables for the first message (index 0)
  const vars0 = bind._getVariables({ type: "message", message_id: 0 });
  assert(vars0.stat_data.health === 100, "Get variables for index 0 matches");

  // B. Test variables for negative index -1 (should resolve to index 1, the latest message)
  const varsMinus1 = bind._getVariables({ type: "message", message_id: -1 });
  assert(varsMinus1.stat_data.health === 90, "Get variables for index -1 resolves to last message");

  // C. Test variables for 'latest' string (should also resolve to index 1)
  const varsLatest = bind._getVariables({ type: "message", message_id: "latest" });
  assert(varsLatest.stat_data.health === 90, "Get variables for 'latest' resolves to last message");

  console.log("✔ Message ID resolution in getVariables verified successfully!");

  console.log("\n--- Testing variables setters with negative/latest IDs ---");

  // D. Test _replaceVariables with message_id: -1
  sessionSaved = null;
  bind._replaceVariables({ stat_data: { health: 80, name: "Traveler" } }, { type: "message", message_id: -1 });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert(sessionSaved !== null, "Session is saved after replaceVariables");
  if (!sessionSaved) throw new Error("sessionSaved is null");
  const lastMsgExtra = (sessionSaved as ChatSession).messages[1].extra;
  assert(lastMsgExtra?.variables?.[0]?.stat_data?.health === 80, "replaceVariables with index -1 updates the last message");

  // E. Test _setChatMessage with id: -1
  sessionSaved = null;
  bind._setChatMessage(-1, {
    variables: { stat_data: { health: 70, name: "Traveler" } }
  });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert(sessionSaved !== null, "Session is saved after setChatMessage");
  if (!sessionSaved) throw new Error("sessionSaved is null");
  const lastMsgExtra2 = (sessionSaved as ChatSession).messages[1].extra;
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
  const lastMsgExtra3 = (sessionSaved as ChatSession).messages[1].extra;
  assert(lastMsgExtra3?.variables?.[0]?.stat_data?.health === 60, "setChatMessages with index -1 updates the last message variables");

  console.log("✔ Message ID resolution in variables setters verified successfully!");

  // Clean up
  cleanTavernHelperBridge();
  console.log("\n=================================================");
  console.log("🎉 ALL BRIDGE TESTS PASSED SUCCESSFULLY!");
  console.log("=================================================");
}

runTests().catch(err => {
  console.error("\n❌ TESTS FAILED!");
  console.error(err.stack || err.message);
  process.exit(1);
});
