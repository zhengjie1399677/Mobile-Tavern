import * as fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf-8');

function removeGeminiBlock(source) {
    let output = source;
    while(true) {
        let idx = output.indexOf('if (settings.api.type === "gemini-builtin") {');
        if (idx === -1) break;
        let elseIdx = output.indexOf('} else {', idx);
        
        let endMatch1 = '        const updatedMessagesWithCompleteAi = msgsForSaving.map((m) =>';
        let endMatch2 = '          if (resData.choices && resData.choices.length > 0) {';
        
        let endIdx = output.indexOf(endMatch1, elseIdx);
        let blockType = 1;
        if (endIdx === -1) {
            endIdx = output.indexOf(endMatch2, elseIdx);
            blockType = 2;
        }
        
        if (endIdx === -1) {
            console.error('End index not found!');
            break;
        }
        
        if (blockType === 1) {
            let preBlock = output.substring(0, idx);
            let openaiBlock = output.substring(elseIdx + '} else {'.length, endIdx);
            // strip the last '      }' from openai block
            const matchClosing = openaiBlock.lastIndexOf('      }');
            if (matchClosing !== -1) {
                // remove this closing brace
                openaiBlock = openaiBlock.substring(0, matchClosing) + openaiBlock.substring(matchClosing + '      }'.length);
            }
            let postBlock = output.substring(endIdx);
            output = preBlock + openaiBlock + postBlock;
        } else {
             let endBlock = output.indexOf('          }', endIdx);
             endBlock = output.indexOf('}', endBlock + 1); 
             let openaiBlock = output.substring(elseIdx + '} else {'.length, endBlock + 1);
             let preBlock = output.substring(0, idx);
             let postBlock = output.substring(endBlock + 1);
             output = preBlock + openaiBlock + postBlock;
        }
    }
    return output;
}

content = removeGeminiBlock(content);
fs.writeFileSync('src/App.tsx', content);

console.log("Done");
