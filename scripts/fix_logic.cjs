const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// Fix duplicates
const dupRegex = /const \[showFullHistory, setShowFullHistory\] = useState\(false\);\s*useEffect\(\(\) => \{\s*setShowFullHistory\(false\);\s*\}, \[activeSessionId\]\);/g;
const match = content.match(dupRegex);
if (match && match.length > 1) {
    // replace all but one
    let count = 0;
    content = content.replace(dupRegex, (m) => {
        count++;
        return count === 1 ? m : '';
    });
}

// 20 message fold logic (recent 10 interactive rounds)
const oldFoldCode = `let messagesToRender = activeSession?.messages || [];
                    let foldedCount = 0;
                    if (!showFullHistory && messagesToRender.length > 0) {
                      let charCount = 0;
                      let foldIndex = 0;
                      for (let i = messagesToRender.length - 1; i >= 0; i--) {
                        charCount += messagesToRender[i].content.length;
                        if (charCount > 10000 && messagesToRender.length - i >= 4) {
                          foldIndex = i;
                          break;
                        }
                      }
                      if (foldIndex > 0) {
                        foldedCount = foldIndex;
                        messagesToRender = messagesToRender.slice(foldIndex);
                      }
                    }`;

const newFoldCode = `let messagesToRender = activeSession?.messages || [];
                    let foldedCount = 0;
                    if (!showFullHistory && messagesToRender.length > 20) {
                      let foldIndex = messagesToRender.length - 20;
                      foldedCount = foldIndex;
                      messagesToRender = messagesToRender.slice(foldIndex);
                    }`;

if (content.includes(oldFoldCode)) {
    content = content.replace(oldFoldCode, newFoldCode);
} else {
    // Maybe matching issue, let's use regex
    const regex = /let messagesToRender = activeSession\?.messages \|\| \[\];\s*let foldedCount = 0;\s*if \(!showFullHistory && messagesToRender\.length > 0\) \{[\s\S]*?messagesToRender = messagesToRender\.slice\(foldIndex\);\s*\}\s*\}/;
    content = content.replace(regex, newFoldCode);
}

// Add confirmation to Worldbook Character delete (if duplicated, clean up)
content = content.replace(/className="text-red-400"\n\s*>\n\s*擦除\n\s*<\/button>\s*<\/div>\s*<\/div>\s*<p className="text-muted-foreground text-\[11px\] font-light leading-normal">\{entry\.content\}<\/p>\s*<\/div>/g, 
`                            className="text-red-400"
                          >
                            擦除
                          </button>
                        </div>
                      </div>
                      <p className="text-muted-foreground text-[11px] font-light leading-normal">{entry.content}</p>
                    </div>`);


fs.writeFileSync('src/App.tsx', content);
