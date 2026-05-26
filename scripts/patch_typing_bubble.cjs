const fs = require('fs');
let code = fs.readFileSync('src/tabs/ChatTab.tsx', 'utf8');

const targetRegex = /const TypingIndicator = \(\) => \{\s*return \([\s\S]*?\);\s*\};/;

const replacement = `const TypingIndicator = () => {
  return (
    <div className="flex items-center gap-1.5 p-2 px-1">
      <div className="w-1.5 h-1.5 bg-primary/70 rounded-full animate-[bounce_1.2s_infinite]" style={{ animationDelay: '0ms' }} />
      <div className="w-1.5 h-1.5 bg-primary/70 rounded-full animate-[bounce_1.2s_infinite]" style={{ animationDelay: '200ms' }} />
      <div className="w-1.5 h-1.5 bg-primary/70 rounded-full animate-[bounce_1.2s_infinite]" style={{ animationDelay: '400ms' }} />
    </div>
  );
};`;

code = code.replace(targetRegex, replacement);

fs.writeFileSync('src/tabs/ChatTab.tsx', code);
console.log("Patched TypingIndicator");
