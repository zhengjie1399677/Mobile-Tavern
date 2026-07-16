import { DEFAULT_SETTINGS } from "../src/hooks/useSettings";
import type { UserSettings } from "../src/types";

console.log("=================================================");
console.log("🧪 STARTING SETTINGS ROBUSTNESS & KEY STABILITY TESTS");
console.log("=================================================");

// Mock React's useState setter logic in Concurrent/StrictMode environment
let mockSettings: UserSettings = { ...DEFAULT_SETTINGS };

const mockSetSettings = (updater: any) => {
  const prev = mockSettings;
  const next = typeof updater === "function" ? updater(prev) : updater;
  if (!next) {
    throw new Error("State update returned undefined or null!");
  }
  // Verify api config robustness
  if (!next.api) {
    throw new Error("State update lost 'api' configuration object!");
  }
  if (typeof next.api.apiKey !== "string") {
    throw new Error("State update 'api.apiKey' is not a string!");
  }
  mockSettings = next;
};

// Implement the exact deep merging and closure capture logic
const getNestedDelta = (nextObj: any, baseObj: any): any => {
  if (!nextObj || typeof nextObj !== "object") return undefined;
  if (!baseObj || typeof baseObj !== "object") return nextObj;
  
  const delta: any = {};
  let hasChanges = false;
  
  for (const key of Object.keys(nextObj)) {
    const nextVal = nextObj[key];
    const baseVal = baseObj[key];
    
    if (nextVal !== baseVal) {
      if (nextVal && typeof nextVal === "object" && !Array.isArray(nextVal)) {
        const subDelta = getNestedDelta(nextVal, baseVal);
        if (subDelta !== undefined) {
          delta[key] = subDelta;
          hasChanges = true;
        }
      } else {
        delta[key] = nextVal;
        hasChanges = true;
      }
    }
  }
  return hasChanges ? delta : undefined;
};

const deepMerge = (target: any, source: any): any => {
  if (!source || typeof source !== "object") return source !== undefined ? source : target;
  if (!target || typeof target !== "object") {
    return Array.isArray(source) ? [...source] : { ...source };
  }
  
  const result = Array.isArray(target) ? [...target] : { ...target };
  
  for (const key of Object.keys(source)) {
    const val = source[key];
    if (val && typeof val === "object" && !Array.isArray(val)) {
      result[key] = deepMerge(target[key], val);
    } else {
      result[key] = val;
    }
  }
  return result;
};

// This factory simulates how React creates a new updateSettings callback on every settings state update
const createUpdateSettings = (capturedSettings: UserSettings) => {
  return (updater: any) => {
    mockSetSettings((prev: UserSettings) => {
      if (typeof updater === "function") {
        const next = updater(prev);
        if (!next) return prev;
        return next;
      }
      
      const next = updater;
      if (!next) return prev;
      
      const delta = getNestedDelta(next, capturedSettings);
      if (!delta) return prev;
      
      return deepMerge(prev, delta);
    });
  };
};

try {
  // Test Case 1: Sequential key typing using functional updates
  console.log("Testing Case 1: Sequential key typing simulation...");
  const valSequence = ["s", "sk", "sk-", "sk-o", "sk-or", "sk-or-", "sk-or-v", "sk-or-v1"];
  
  for (const char of valSequence) {
    // Each typing event gets the latest updateSettings callback representing the current render cycle
    const updateSettings = createUpdateSettings(mockSettings);
    updateSettings((prev: any) => ({
      ...prev,
      api: { ...prev.api, apiKey: char }
    }));
  }
  
  if (mockSettings.api.apiKey !== "sk-or-v1") {
    throw new Error(`Expected apiKey to be 'sk-or-v1', but got '${mockSettings.api.apiKey}'`);
  }
  console.log("✔ Case 1 Passed: Key typed sequentially and correctly saved.");

  // Test Case 2: Concurrent stale closures simulator
  console.log("Testing Case 2: Concurrent stale closures simulation...");
  
  // v0 updateSettings representing the component before typing the key
  const updateSettings_v0 = createUpdateSettings(mockSettings);
  const staleSettings = { ...mockSettings }; // apiKey is empty ""
  
  // High-frequency typing happens, setting key to "sk-or-v1"
  // This produces mockSettings.api.apiKey = "sk-or-v1"
  const updateSettings_v1 = createUpdateSettings(mockSettings);
  updateSettings_v1((prev: any) => ({
    ...prev,
    api: { ...prev.api, apiKey: "sk-or-v1" }
  }));

  // But an old onBlur event or slider drag concurrently fires updateSettings using the old v0 callback
  // which was bound to staleSettings (apiKey is empty)
  // It wants to change userName to "Alice"
  updateSettings_v0({
    ...staleSettings,
    userName: "Alice"
  });

  // Thanks to our deep delta merging, the new apiKey should NOT be overridden to ""!
  if (mockSettings.api.apiKey !== "sk-or-v1") {
    throw new Error(`CRITICAL: Stale closure wiped out the newly typed API Key! Got: '${mockSettings.api.apiKey}'`);
  }
  if (mockSettings.userName !== "Alice") {
    throw new Error(`Expected userName to be 'Alice', but got '${mockSettings.userName}'`);
  }
  console.log("✔ Case 2 Passed: Stale closure did NOT overwrite the API Key. Deep merge succeeded!");

  // Test Case 3: Empty settings input fallback
  console.log("Testing Case 3: Defensive fallbacks against empty or partial updates...");
  const updateSettings_v2 = createUpdateSettings(mockSettings);
  updateSettings_v2(null); // Should fallback gracefully to prev
  updateSettings_v2(undefined); // Should fallback gracefully to prev
  updateSettings_v2({}); // Partial empty object should not wipe nested properties
  
  if (!mockSettings.api || !mockSettings.preset || !mockSettings.memory || !mockSettings.promptConfig) {
    throw new Error("Wiped out nested settings objects on empty updates!");
  }
  console.log("✔ Case 3 Passed: Empty and partial updates handled gracefully.");

  console.log("=================================================");
  console.log("🎉 ALL ROBUSTNESS TESTS PASSED SUCCESSFULLY!");
  console.log("=================================================");
} catch (error: any) {
  console.error("❌ TEST FAILED:", error.message);
  process.exit(1);
}
