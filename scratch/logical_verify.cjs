const assert = require("assert");

// 1. Mock functions from streamReader.ts
function mockReadSSEStream(blockText, callbacks) {
  let pbuf = blockText;
  let streamDone = false;

  const flushBuffer = (forceAll = false) => {
    let boundary = pbuf.indexOf("\n\n");
    if (forceAll && boundary === -1 && pbuf.trim().length > 0) {
      boundary = pbuf.length;
    }

    while (boundary >= 0) {
      const block = pbuf.slice(0, boundary);
      pbuf = pbuf.slice(boundary + 2);

      const dataLines = block
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6));

      if (dataLines.length > 0) {
        const mergedData = dataLines.join("\n").trim();
        if (mergedData === "[DONE]") {
          streamDone = true;
          callbacks.onDone?.();
          return;
        }
        if (mergedData) {
          callbacks.onData(mergedData);
        }
      }

      boundary = pbuf.indexOf("\n\n");
      if (forceAll && boundary === -1 && pbuf.trim().length > 0) {
        boundary = pbuf.length;
      }
    }
  };

  flushBuffer(true);
}

// Verification 1: Test multi-line data parsing
console.log("=== Verification 1: Multi-line SSE Parsing ===");
const sampleMultiLineBlock = 
  "data: {\"choices\": [{\"delta\": {\"content\": \"hello\\nworld\"}\n" +
  "data: }]}\n\n";

let receivedPayload = null;
mockReadSSEStream(sampleMultiLineBlock, {
  onData: (data) => {
    receivedPayload = data;
  }
});

console.log("Received merged payload:", JSON.stringify(receivedPayload));
try {
  const parsed = JSON.parse(receivedPayload);
  assert.strictEqual(parsed.choices[0].delta.content, "hello\nworld");
  console.log("✅ Multi-line SSE payload merged and parsed successfully!");
} catch (e) {
  console.error("❌ Multi-line SSE parsing failed:", e);
  process.exit(1);
}

// 2. Mock budget sorting and cutoff from promptBuilder.ts
function mockBudgetLorebook(activeEntries, BUDGET_LIMIT = 6000) {
  // Sort by order weight (ascending, default 100)
  activeEntries.sort((a, b) => {
    const orderA = a.order !== undefined ? a.order : 100;
    const orderB = b.order !== undefined ? b.order : 100;
    return orderA - orderB;
  });

  let currentLength = 0;
  const budgetedEntries = [];
  for (const entry of activeEntries) {
    const len = entry.content ? entry.content.length : 0;
    if (budgetedEntries.length === 0 || currentLength + len <= BUDGET_LIMIT) {
      budgetedEntries.push(entry);
      currentLength += len;
    } else {
      console.log(`[promptBuilder] Skip and BREAK on entry "${entry.id}" (len ${len}) as it exceeds budget ${BUDGET_LIMIT - currentLength}`);
      break;
    }
  }
  return budgetedEntries;
}

// Verification 2: Test Lorebook budget queue priority ordering
console.log("\n=== Verification 2: Lorebook Budget Ordering ===");
const entries = [
  { id: "A", order: 10, content: "A".repeat(5000) }, // High priority, fits
  { id: "B", order: 20, content: "B".repeat(2000) }, // Medium priority, overflows 6000 (total 7000), should BREAK
  { id: "C", order: 30, content: "C".repeat(500) },  // Low priority, fits if B is skipped (which is the bug we fixed), but should not fit now
];

const result = mockBudgetLorebook(entries, 6000);
console.log("Selected Lorebook entries:", result.map(e => e.id));

try {
  assert.deepStrictEqual(result.map(e => e.id), ["A"]);
  console.log("✅ Budget cutoff priority verified: Low priority entries blocked from bypassing!");
} catch (e) {
  console.error("❌ Budget cutoff ordering failed:", e);
  process.exit(1);
}

console.log("\n=== Verification 3: JSON5.parse MVU parameter evaluation ===");
const JSON5 = require("json5");
const rawParam = '{ score: (function(){ return 99; })() }';
try {
  // Check if JSON5 handles key without quotes
  const parsedObj = JSON5.parse('{ score: 99 }');
  assert.strictEqual(parsedObj.score, 99);
  console.log("✅ JSON5 safely parses unquoted key.");
  
  // Check if JSON5 correctly rejects javascript function/exec code (prevent RCE)
  try {
    JSON5.parse(rawParam);
    console.error("❌ Safety Failure: JSON5 parsed executing code!");
    process.exit(1);
  } catch (err) {
    console.log("✅ JSON5 successfully blocked execution: " + err.message);
  }
} catch (e) {
  console.error("❌ JSON5 verification failed:", e);
  process.exit(1);
}

console.log("\n✅ All logic verifications passed successfully!");
