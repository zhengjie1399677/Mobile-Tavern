const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

const replacements = {
  'border-amber-500/60 bg-[#1d1d22]/40" : "border-[#222227]': 'border-primary/60 bg-muted/40" : "border-border',
  'bg-[#232328] p-0.5 rounded-lg border border-[#2b2b32]': 'bg-muted p-0.5 rounded-lg border border-border',
  'bg-[#1b1b1f] border-b border-border': 'bg-muted/50 border-b border-border',
  'group bg-[#18181b] p-3': 'group bg-card p-3',
  'bg-[#18181c] border border-border': 'bg-card border border-border',
  'ring-[#121214]': 'ring-background',
  'border-amber-500/60 bg-[#1d1d22]/40" : "border-[#222227]"': 'border-primary/60 bg-muted/40" : "border-border"',
};

for (const [key, val] of Object.entries(replacements)) {
  content = content.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), val);
}

fs.writeFileSync('src/App.tsx', content);
