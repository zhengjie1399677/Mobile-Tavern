const fs = require('fs');
let code = fs.readFileSync('src/tabs/ChatTab.tsx', 'utf8');

const replacement1 = `
const ChatInputArea = () => {
  const { isSending, setIsSending, activeSession, settings, activeCharacter, handleRerollLast, showCustomConfirm, handleAutoSummaryCheck, handleSendMessage } = React.useContext(AppContext);
  const [localInput, setLocalInput] = React.useState('');

  const onSend = () => {
    if (!localInput.trim()) return;
    const msg = localInput;
    setLocalInput('');
    handleSendMessage(msg);
  };

  return (
    <div className="bg-card p-3 border-t border-border flex flex-col gap-2 z-10 shrink-0">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3">
          <button
            onClick={() => handleRerollLast()}
            disabled={isSending || !activeSession || !activeSession.messages.some((m: any) => m.sender === 'assistant')}
            className="flex items-center gap-1.5 text-muted-foreground hover:text-primary disabled:opacity-40 transition-colors"
            title="消除整条故事分支的最后一条AI回复并进行重新生成"
          >
            <RefreshCw className={\`w-3.5 h-3.5 \${isSending ? 'animate-spin' : ''}\`} />
            <span className="text-[10px] font-medium">重载上一段剧情</span>
          </button>
          <button
            onClick={async () => {
              if (!activeSession) return;
              const ok = await showCustomConfirm('是否启动智能AI卡片压缩？这会将更早的历史对话转化为单条时间轴年表，腾出内存空间，保持语调连贯。');
              if (ok) {
                setIsSending(true);
                await handleAutoSummaryCheck(activeSession);
                setIsSending(false);
              }
            }}
            className="flex items-center gap-1.5 text-muted-foreground hover:text-primary transition-colors"
            title="呼叫智能记忆压缩年表"
          >
            <Brain className="w-3.5 h-3.5" />
            <span className="text-[10px] font-medium">整理潜意识碎片</span>
          </button>
        </div>
        
        <div className="flex items-center gap-1.5 text-muted-foreground font-mono text-[9px] opacity-70">
          <Cpu className="w-3 h-3" />
          <span>发包预测: ~{Math.ceil(((localInput || '').length * 1.5) + ((activeSession?.messages.slice(-(settings.memory.recentTurns)).reduce((acc: any, m: any) => acc + (m.content || '').length, 0) || 0) * 1.5) + (((activeCharacter?.description || '').length || 0) + ((activeCharacter?.personality || '').length || 0) + ((activeCharacter?.scenario || '').length || 0) + ((activeCharacter?.system_prompt || '').length || 0)) * 1.5)} tok</span>
        </div>
      </div>
      <div className="flex items-end gap-2">
        <textarea
          value={localInput}
          onChange={(e) => setLocalInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={\`发送一条纯文本对白至 \${activeCharacter?.name} 并启程...\`}
          rows={2}
          className="flex-1 bg-muted border border-border rounded-lg p-2.5 text-xs text-foreground focus:outline-none focus:border-primary/50 resize-none font-light"
        />
        <button
          onClick={onSend}
          disabled={isSending || !localInput.trim()}
          className="p-3 rounded-lg bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground text-primary-foreground transition-all shadow-md flex items-center justify-center shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default function ChatTab() {`;

code = code.replace("export default function ChatTab() {", replacement1);

const targetRegex = /\{\/\* Bottom Input typing station bar \*\/\}([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*\)\}/;
code = code.replace(targetRegex, "                <ChatInputArea />\n              </div>\n            )}");

fs.writeFileSync('src/tabs/ChatTab.tsx', code);
console.log('Replaced successfully');
