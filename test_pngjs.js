import fs from 'fs';
import { PNG } from 'pngjs';

fs.createReadStream('browser_canvas_injected.png')
  .pipe(new PNG({ filterType: 4 }))
  .on('parsed', function() {
    console.log("Parsed PNG! Width:", this.width, "Height:", this.height);
  })
  .on('error', function(err) {
    console.error("PNG Parse error:", err);
  });
