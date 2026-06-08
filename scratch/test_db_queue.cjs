// Simulation of enqueueWrite and writeQueue
let writeQueue = Promise.resolve();

function enqueueWrite(operation) {
  const result = writeQueue.then(operation);
  writeQueue = result.then(
    () => {},
    () => {}
  );
  return result;
}

// Helper to wait
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runTests() {
  console.log("=== Testing localDB enqueueWrite Concurrency Queue ===");
  const executionOrder = [];
  
  // 1. Queue operations concurrently
  const p1 = enqueueWrite(async () => {
    executionOrder.push("start 1");
    await delay(100);
    executionOrder.push("end 1");
    return "val1";
  });
  
  const p2 = enqueueWrite(async () => {
    executionOrder.push("start 2 (fail)");
    await delay(50);
    executionOrder.push("end 2 (fail)");
    throw new Error("error2");
  });
  
  const p3 = enqueueWrite(async () => {
    executionOrder.push("start 3");
    await delay(30);
    executionOrder.push("end 3");
    return "val3";
  });

  // Check the return values and exceptions
  try {
    const r1 = await p1;
    console.log("p1 resolved with:", r1);
  } catch (e) {
    console.log("p1 failed:", e.message);
  }

  try {
    const r2 = await p2;
    console.log("p2 resolved with:", r2);
  } catch (e) {
    console.log("p2 failed with:", e.message);
  }

  try {
    const r3 = await p3;
    console.log("p3 resolved with:", r3);
  } catch (e) {
    console.log("p3 failed:", e.message);
  }

  console.log("Execution order:", executionOrder);
  
  // Verify execution order is strictly sequential (no overlap)
  const expectedOrder = [
    "start 1", "end 1",
    "start 2 (fail)", "end 2 (fail)",
    "start 3", "end 3"
  ];
  
  const isCorrect = JSON.stringify(executionOrder) === JSON.stringify(expectedOrder);
  console.log("Is execution order correct and sequential?", isCorrect ? "YES" : "NO");
}

runTests();
