const fs = require('fs');
fetch('https://static.crates.io/crates/tauri-cli/2.0.0/tauri-cli-2.0.0.crate')
  .then(res => res.arrayBuffer())
  .then(buffer => {
    fs.writeFileSync('tauri-cli.tar.gz', Buffer.from(buffer));
    console.log("Written");
  });
