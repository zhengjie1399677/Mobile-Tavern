const fs = require('fs');
let code = fs.readFileSync('src/tabs/ChatTab.tsx', 'utf8');

const targetRegex = /\{\/\* Circle Avatar fallback \*\/\}\s*<div className=\{\`w-8 h-8 rounded bg-gradient-to-br flex items-center justify-center font-bold text-xs shadow-md border flex-shrink-0 \$\{\s*isUser \? "from-secondary to-muted border-border text-foreground" : "from-card to-muted border-border text-foreground font-serif"\s*\}\`\}>\s*\{isUser \? "我" : activeCharacter\?.name\?\.\[0\] \|\| "AI"\}\s*<\/div>/g;

const replacement = `{/* Circle Avatar fallback */}
                        <div className={\`w-8 h-8 rounded-[11px] bg-gradient-to-br flex items-center justify-center font-bold text-xs shadow-sm border flex-shrink-0 overflow-hidden \${
                          isUser ? "from-secondary to-muted border-border text-foreground" : "from-card to-muted border-border text-foreground font-serif"
                        }\`}>
                          {isUser ? "我" : (!isSystem && activeCharacter?.avatar ? <img src={activeCharacter.avatar} alt={activeCharacter.name} className="w-full h-full object-cover" /> : (activeCharacter?.name?.[0] || "AI"))}
                        </div>`;

code = code.replace(targetRegex, replacement);

fs.writeFileSync('src/tabs/ChatTab.tsx', code);
console.log('Patched');
