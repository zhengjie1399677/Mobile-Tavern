const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

let fixBottomOld = `                    );
                  })}
 
                  {/* Typing Indicator */}`;

let fixBottomNew = `                    );
                  })}
                      </>
                    );
                  })()}
 
                  {/* Typing Indicator */}`;

content = content.replace(fixBottomOld, fixBottomNew);
fs.writeFileSync('src/App.tsx', content);
