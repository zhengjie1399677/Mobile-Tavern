import fs from 'fs';

const urls = [
  'https://placehold.co/1024x1024/0f172a/38bdf8.png?text=AI+Worldbook',
  'https://dummyimage.com/1024x1024/0f172a/38bdf8.png?text=AI+Worldbook',
  'https://picsum.photos/1024'
];

async function run() {
  for (const url of urls) {
    try {
      console.log(`Attempting to fetch icon from: ${url}`);
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) {
        console.warn(`Fetch failed with status: ${res.status}`);
        continue;
      }
      const buffer = await res.arrayBuffer();
      const nodeBuffer = Buffer.from(buffer);
      
      // Validate PNG signature: 89 50 4E 47 0D 0A 1A 0A
      if (nodeBuffer.length > 8 &&
          nodeBuffer[0] === 137 &&
          nodeBuffer[1] === 80 &&
          nodeBuffer[2] === 78 &&
          nodeBuffer[3] === 71 &&
          nodeBuffer[4] === 13 &&
          nodeBuffer[5] === 10 &&
          nodeBuffer[6] === 26 &&
          nodeBuffer[7] === 10) {
        fs.writeFileSync('app-icon.png', nodeBuffer);
        console.log(`Successfully wrote a valid PNG of size ${nodeBuffer.length} bytes to app-icon.png`);
        return;
      } else {
        console.warn(`Fetched resource did not have a valid PNG signature. First 8 bytes: ${Array.from(nodeBuffer.slice(0, 8)).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')}`);
      }
    } catch (err) {
      console.error(`Error during fetch of ${url}:`, err);
    }
  }
  
  throw new Error("Unable to obtain a valid PNG image for appicon creation.");
}

run();
