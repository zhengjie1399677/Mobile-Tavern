async function testGemma4() {
  const apiKey = "PLACEHOLDER_KEY";
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "google/gemma-4-31b-it:free",
        messages: [{ role: "user", content: "Hello" }]
      })
    });
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Response text:", text);
  } catch (e) {
    console.error("Error:", e);
  }
}

testGemma4();
