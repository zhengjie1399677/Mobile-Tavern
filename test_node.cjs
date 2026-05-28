const { execSync } = require("child_process");
try {
  console.log(execSync(`node --print "require.resolve('@tauri-apps/cli/package.json')"`).toString());
} catch(e) {
  console.error(e.message);
}
