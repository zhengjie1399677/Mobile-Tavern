const fs = require('fs');
let code = fs.readFileSync('src/tabs/ChatTab.tsx', 'utf8');

const targetStr = `<span>发包预测: ~{Math.ceil(((localInput || '').length * 1.5) + ((activeSession?.messages.slice(-(settings.memory.recentTurns)).reduce((acc: any, m: any) => acc + (m.content || '').length, 0) || 0) * 1.5) + (((activeCharacter?.description || '').length || 0) + ((activeCharacter?.personality || '').length || 0) + ((activeCharacter?.scenario || '').length || 0) + ((activeCharacter?.system_prompt || '').length || 0)) * 1.5)} tok</span>`;

const repStr = `<span>发包预测: ~{Math.ceil((
            (localInput || '').length * 1.5 + 
            ((activeSession?.messages.slice(-(settings.memory.recentTurns)).reduce((acc: any, m: any) => acc + (m.content || '').length, 0) || 0) * 1.5) + 
            (((activeCharacter?.description || '').length + (activeCharacter?.personality || '').length + (activeCharacter?.scenario || '').length + (activeCharacter?.system_prompt || '').length) * 1.5) +
            (((settings.promptConfig?.customPrompts || []).filter((p: any) => p.enabled).reduce((acc: any, p: any) => acc + (p.content || '').length, 0)) * 1.5) +
            ((activeSession?.summaries || []).reduce((acc: any, s: any) => acc + (s.content || '').length, 0) * 1.5)
          ))} tok</span>`;

code = code.replace(targetStr, repStr);
fs.writeFileSync('src/tabs/ChatTab.tsx', code);
console.log("Patched ChatTab.tsx token estimator");
