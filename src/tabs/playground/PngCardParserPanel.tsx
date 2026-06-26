import { VenetianMask } from "lucide-react";
import type { PlaygroundActions } from "./usePlaygroundActions";

interface PngCardParserPanelProps {
  actions: PlaygroundActions;
}

export default function PngCardParserPanel({ actions }: PngCardParserPanelProps) {
  const { pngData, pngParseError, handleCardUpload } = actions;

  return (
    <div className="space-y-4 animate-[fadeIn_0.2s_ease-out]">
      <div className="p-3 bg-muted/40 rounded-lg text-xs leading-relaxed border border-border">
        <span className="font-semibold text-primary">说明：</span>
        分析和读取酒馆角色卡 PNG 文件的二进制数据块。您可以选择本地的一张标准角色卡 PNG 图像拖入这里，本解析器会提取 `tEXt` 区块中的 `chara` 信息并将其解压，转换成结构化 JSON。
      </div>

      {/* Dropzone */}
      <div className="bg-card border border-dashed border-border p-6 rounded-lg text-center relative hover:bg-muted/10 transition-all flex flex-col items-center justify-center">
        <VenetianMask className="w-8 h-8 text-muted-foreground/60 mb-2" />
        <span className="text-xs font-semibold block mb-1">选择或拖拽酒馆 PNG 角色卡</span>
        <span className="text-[10px] text-muted-foreground">仅做前端本地提取，不会向任何服务器发送卡片</span>
        <input
          type="file"
          accept="image/png"
          onChange={handleCardUpload}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
      </div>

      {/* Error view */}
      {pngParseError && (
        <div className="p-3 bg-red-500/10 text-red-500 border border-red-500/30 rounded text-xs">
          解析失败: {pngParseError}
        </div>
      )}

      {/* JSON Output Tree */}
      {pngData && (
        <div className="bg-card border border-border rounded-lg overflow-hidden animate-[slideUp_0.3s_ease-out]">
          <div className="bg-muted px-3 py-1.5 text-[10px] font-semibold text-muted-foreground border-b border-border flex items-center justify-between">
            <span>卡片二进制元数据分析树</span>
            <span className="text-green-500 font-bold">成功解码 (200 OK)</span>
          </div>
          <div className="p-3 bg-black/5 dark:bg-black/40 font-mono text-[10px] max-h-[300px] overflow-y-auto leading-normal">
            <pre className="whitespace-pre-wrap text-foreground/80">{JSON.stringify(pngData, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
