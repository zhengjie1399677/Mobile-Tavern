const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const targetState = `  const [newSummaryLoc, setNewSummaryLoc] = useState("");
  const [newSummaryContent, setNewSummaryContent] = useState("");`;
const replacementState = `  const [newSummaryLoc, setNewSummaryLoc] = useState("");
  const [newSummaryContent, setNewSummaryContent] = useState("");
  const [editingSummaryId, setEditingSummaryId] = useState<string | null>(null);`;
code = code.replace(targetState, replacementState);

const targetHandler = /const handleAddTimelineSummary = async \(\) => \{[\s\S]*?(?=  \/\/ Load lorebook entry)/;
const replacementHandler = `const handleAddTimelineSummary = async () => {
    if (!newSummaryTag.trim() || !newSummaryContent.trim() || !activeSession) return;

    if (editingSummaryId) {
      // Update existing summary
      const nextSums = activeSession.summaries.map(s => {
        if (s.id === editingSummaryId) {
          return { ...s, timeTag: newSummaryTag.trim(), location: newSummaryLoc.trim(), content: newSummaryContent.trim() };
        }
        return s;
      });
      const updatedSession = { ...activeSession, summaries: nextSums };
      setSessions(prev => prev.map(s => s.id === updatedSession.id ? updatedSession : s));
      await saveSession(updatedSession);
      setTimelineModalOpen(false);
      setEditingSummaryId(null);
      return;
    }

    const newCard: SummaryCard = {
      id: "summary_" + Math.random().toString(36).substring(2, 9),
      timeTag: newSummaryTag.trim(),
      location: newSummaryLoc.trim() || "未知地点",
      content: newSummaryContent.trim()
    };

    const updatedSession = {
      ...activeSession,
      summaries: [...activeSession.summaries, newCard]
    };

    setSessions((prev) => prev.map((s) => s.id === updatedSession.id ? updatedSession : s));
    await saveSession(updatedSession);
    
    setTimelineModalOpen(false);
  };
`;
code = code.replace(targetHandler, replacementHandler);

const targetButton = `<Clock className="w-4 h-4 text-primary" /> 手动编纂年表时间卡`;
const replacementButton = `<Clock className="w-4 h-4 text-primary" /> {editingSummaryId ? "编辑年表时间卡" : "手动编纂年表时间卡"}`;
code = code.replace(targetButton, replacementButton);

const submitButtonTarget = `<button
                  onClick={handleAddTimelineSummary}
                  disabled={!newSummaryTag.trim() || !newSummaryContent.trim()}
                  className="bg-primary hover:bg-primary disabled:opacity-50 text-primary-foreground px-4 py-1.5 rounded font-bold"
                >
                  确定植入
                </button>`;
const submitButtonReplacement = `<button
                  onClick={handleAddTimelineSummary}
                  disabled={!newSummaryTag.trim() || !newSummaryContent.trim()}
                  className="bg-primary hover:bg-primary disabled:opacity-50 text-primary-foreground px-4 py-1.5 rounded font-bold"
                >
                  {editingSummaryId ? "保存修改" : "确定植入"}
                </button>`;
code = code.replace(submitButtonTarget, submitButtonReplacement);

fs.writeFileSync('src/App.tsx', code);
console.log("Patched App.tsx timeline summary editing");
