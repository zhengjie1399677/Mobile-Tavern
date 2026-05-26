const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');
content = content.replace(
  "          </div>\n        )}\n\n      {/* ================= MODAL L: CREATE/EDIT CHARACTER ================= */}",
  "          </div>\n        )}\n\n      </div>\n\n      {/* ================= MODAL L: CREATE/EDIT CHARACTER ================= */}"
);
fs.writeFileSync('src/App.tsx', content);
