const fs = require('fs');
try {
  const card = JSON.parse(fs.readFileSync('scratch/yangzhou.json', 'utf8'));
  const scripts = card.extensions?.tavern_helper?.scripts || [];
  console.log(`Found ${scripts.length} scripts.`);
  scripts.forEach((s) => {
    console.log(`Script ID: ${s.id}, Name: ${s.name}, Enabled: ${s.enabled}`);
    if (s.content) {
      console.log("--- Content Snippet (first 1000 chars) ---");
      console.log(s.content.substring(0, 1000));
      console.log("-----------------------------------------");
    }
  });
} catch(e) {
  console.error("Error reading card:", e);
}
