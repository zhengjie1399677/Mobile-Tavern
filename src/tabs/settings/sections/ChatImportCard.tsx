import { MessageSquare, Upload } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "../../../../components/ui/card";
import type { UnifiedAppContextProps } from "../../../UnifiedAppContext";

export interface ChatImportCardProps extends Pick<UnifiedAppContextProps, "handleImportSillyChatHistory"> {}

export default function ChatImportCard({
  handleImportSillyChatHistory,
}: ChatImportCardProps) {
  return (
    <Card className="bg-card border-border shadow-sm mt-2">
      <CardHeader className="pb-2.5 border-b border-border/50 px-3 pt-3">
        <CardTitle className="text-xs flex items-center gap-2 font-bold text-foreground">
          <MessageSquare className="w-4 h-4 text-primary" /> 导入酒馆单会话聊天记录
        </CardTitle>
        <CardDescription className="text-[10px] mt-0.5">
          导入 SillyTavern 单个角色的聊天记录 (.json/.jsonl) 格式文件
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-3 px-3 pb-3 space-y-3">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          系统将解析对话记录并与本地角色卡进行绑定。如果本地未导入对应的角色卡，会提示先导入角色卡。
          <br />
          <span className="text-primary font-medium">提示：</span>导入后系统默认关闭这些历史句子的自动总结功能，以避免 API 频宽雪崩。
        </p>
        <div className="flex font-bold text-xs">
          <label className="w-full bg-background hover:bg-muted border border-border shadow-sm text-foreground py-2 rounded-md transition flex justify-center items-center gap-1.5 cursor-pointer">
            <Upload className="w-3.5 h-3.5 text-emerald-500" /> 选择聊天文件并导入
            <input
              type="file"
              onChange={handleImportSillyChatHistory}
              accept=".json,.jsonl,.txt,.bin,application/json,text/plain"
              className="hidden"
            />
          </label>
        </div>
      </CardContent>
    </Card>
  );
}
