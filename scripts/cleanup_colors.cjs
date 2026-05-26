const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

const replacements = {
  // Manual raw vars
  'bg-[var(--bg-main)]': 'bg-background',
  'bg-[var(--bg-card)]': 'bg-card',
  'bg-[var(--bg-card-muted)]': 'bg-muted',
  'bg-[var(--bg-input)]': 'bg-input',
  'border-[var(--border-color)]': 'border-border',
  'border-[var(--border-strong)]': 'border-border',
  'border-[var(--border-navbar)]': 'border-border',
  'text-[var(--text-main)]': 'text-foreground',
  'text-[var(--text-muted)]': 'text-muted-foreground',
  'bg-[var(--btn-accent)]': 'bg-primary text-primary-foreground',
  'text-[var(--prose-color)]': 'text-foreground',
  'text-[var(--dialogue-color)]': 'text-foreground',
  
  // Specific hardcoded colors from the root / navbar
  'bg-[#121214]': 'bg-background',
  'bg-[#161619]': 'bg-background',
  'bg-[#17171a]': 'bg-card',
  'bg-[#1a1a1e]': 'bg-muted',
  'bg-[#1e1e22]': 'bg-input',
  'bg-[#101012]': 'bg-muted',
  'bg-[#0a0a0c]': 'bg-background',
  'bg-[#0d0d0f]': 'bg-background',
  
  'border-[#1e1e22]': 'border-border',
  'border-[#232328]': 'border-border',
  'border-[#1f1f23]': 'border-border',
  
  'text-[#e3e3e7]': 'text-foreground',
  'text-[#8e8e93]': 'text-muted-foreground',
  
  // Opacity versions
  'bg-[#161619]/95': 'bg-background/95',
  'bg-[#0d0d0f]/60': 'bg-card/60',
  'bg-black/75': 'bg-black/75',
};

// Regex for tailwind generic stone colors 
content = content.replace(/text-stone-[3456]00/g, 'text-muted-foreground');
content = content.replace(/text-stone-[12]00/g, 'text-foreground');
content = content.replace(/border-stone-[789]00(?:\/\d+)?/g, 'border-border');
content = content.replace(/bg-stone-900(?:\/\d+)?/g, 'bg-muted');

for (const [key, val] of Object.entries(replacements)) {
  content = content.split(key).join(val);
}

fs.writeFileSync('src/App.tsx', content);
