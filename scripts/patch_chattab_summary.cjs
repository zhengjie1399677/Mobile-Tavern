const fs = require('fs');
let code = fs.readFileSync('src/tabs/ChatTab.tsx', 'utf8');

const targetSummaryBlock = /\{\/\* Summary prose item \*\/\}\s*<p className="text-\[12\.5px\] italic font-serif text-muted-foreground leading-relaxed font-light">\{summary.content\}<\/p>/;
const replacementSummaryBlock = `{/* Summary prose item */}
                      <p className="text-[12.5px] italic font-serif text-muted-foreground leading-relaxed font-light">{summary.content}</p>
                      
                      <div className="absolute top-1 right-8 opacity-0 group-hover:opacity-100 transition-opacity flex items-center bg-background/80 backdrop-blur rounded border border-border/50 shadow-sm overflow-hidden">
                        <button
                          onClick={() => {
                            setEditingSummaryId(summary.id);
                            setNewSummaryTag(summary.timeTag);
                            setNewSummaryLoc(summary.location);
                            setNewSummaryContent(summary.content);
                            setTimelineModalOpen(true);
                          }}
                          className="text-muted-foreground hover:text-foreground p-1 border-r border-border/50"
                          title="编辑该条记忆年表"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                      </div>`;

code = code.replace(targetSummaryBlock, replacementSummaryBlock);

fs.writeFileSync('src/tabs/ChatTab.tsx', code);
console.log("Patched ChatTab.tsx summary editing button");
