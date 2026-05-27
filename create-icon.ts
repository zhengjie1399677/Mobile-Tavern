import fs from 'fs';
// A simple 512x512 transparent PNG (or 1x1, let's see if 1x1 is enough for Tauri icon gen)
// Let's actually just fetch a dummy image from a service if we can.
async function run() {
  const res = await fetch('https://dummyimage.com/1024x1024/000/fff.png&text=App');
  const buffer = await res.arrayBuffer();
  fs.writeFileSync('app-icon.png', Buffer.from(buffer));
}
run();
