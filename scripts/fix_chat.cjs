const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

const replacements = {
  // Fix character/system bubbles
  'from-stone-700 to-stone-800 border-stone-600': 'from-secondary to-muted border-border',
  'bg-[#18181b] text-foreground border-border': 'bg-card text-foreground border-border shadow-sm',
  
  // Quick options popups
  'bg-[#1b1b1e] border border-border': 'bg-popover text-popover-foreground border border-border',
  
  // Nav bar adjustments if any left
  'bg-[#161619]/95': 'bg-background/95',
  
  // Ensure preset editor is font-sans not mono
  'resize-y bg-input/50 focus-visible:ring-primary/40 text-prose shadow-inner': 'resize-y bg-input/50 focus-visible:ring-primary/40 text-foreground font-sans shadow-inner',
  'font-mono leading-relaxed resize-y': 'font-sans leading-relaxed resize-y'
};

for (const [key, val] of Object.entries(replacements)) {
  content = content.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), val);
}

// Ensure the user bubble bg is thematic too (currently it's bg-amber-600/10 text-amber-200)
// We want this to adapt to theme. In Sand theme, it should be dark if we want contrast, but typically user msgs are primary-colored
// Let's replace 'bg-amber-600/10 text-amber-200 border-amber-600/35 hover:bg-amber-600/20' with standard primary colors:
content = content.replace(
  'bg-amber-600/10 text-amber-200 border-amber-600/35 hover:bg-amber-600/20',
  'bg-primary text-primary-foreground border-primary/50 hover:bg-primary/90'
);

content = content.replace(
  'text-[11px] text-amber-500 hover:text-amber-400 px-2.5 py-1 rounded hover:bg-amber-950/20 flex items-center gap-1 border border-amber-500/20',
  'text-[11px] text-primary hover:text-primary/80 px-2.5 py-1 rounded hover:bg-primary/10 flex items-center gap-1 border border-primary/20'
);

content = content.replace(
  'text-[11px] text-amber-500 hover:text-amber-400 px-2.5 py-1 rounded hover:bg-amber-950/20 flex items-center gap-1 border border-amber-500/20',
  'text-[11px] text-primary hover:text-primary/80 px-2.5 py-1 rounded hover:bg-primary/10 flex items-center gap-1 border border-primary/20'
);

// Fix AI avatar circle colors
content = content.replace(
  'from-amber-700/80 to-amber-900/85 border-amber-600/50',
  'from-card to-muted border-border'
);

// Fix System messages
content = content.replace(
  'bg-amber-950/20 text-amber-600 text-xs px-3 py-1.5 rounded-lg border border-amber-900/40',
  'bg-primary/10 text-primary text-xs px-3 py-1.5 rounded-lg border border-primary/30'
);

fs.writeFileSync('src/App.tsx', content);
