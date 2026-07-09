import { Lock, Download, Upload } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../../../../components/ui/card";
import { Switch } from "../../../../components/ui/switch";
import { Input } from "../../../../components/ui/input";
import type { UnifiedAppContextProps } from "../../../UnifiedAppContext";

export interface BackupRestoreCardProps extends Pick<UnifiedAppContextProps,
  | "backupPass" | "setBackupPass" | "backupStatus" | "encryptBackup" | "setEncryptBackup"
  | "showBackupUI" | "setShowBackupUI" | "handleExportLocalDataBackup" | "handleImportLocalDataBackup"
> {}

export default function BackupRestoreCard({
  backupPass,
  setBackupPass,
  backupStatus,
  encryptBackup,
  setEncryptBackup,
  showBackupUI,
  setShowBackupUI,
  handleExportLocalDataBackup,
  handleImportLocalDataBackup,
}: BackupRestoreCardProps) {
  return (
    <Card className="bg-card border-border shadow-sm mt-2">
      <CardHeader
        className="py-2.5 px-3 cursor-pointer hover:bg-muted/50 transition-colors border-b border-border/40"
        onClick={() => setShowBackupUI(!showBackupUI)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs flex items-center gap-2 font-bold text-foreground">
            <Lock className="w-4 h-4 text-emerald-500" />{" "}
            离线数据全库备份/还原
          </CardTitle>
          <span className="text-muted-foreground text-[10px]">
            {showBackupUI ? "收起" : "展开"}
          </span>
        </div>
      </CardHeader>
      {showBackupUI && (
        <CardContent className="pt-3 px-3 pb-3 space-y-3 bg-muted/10 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center justify-between border-b border-border/20 pb-2.5">
            <div className="flex flex-col">
              <span className="text-sm font-semibold flex items-center gap-2 text-destructive">
                加密导出保护 (XOR强加密)
              </span>
              <span className="text-[9px] text-muted-foreground mt-0.5">
                推荐开启以防配置文件侧链泄露
              </span>
            </div>
            <Switch
              aria-label="加密导出保护"
              checked={encryptBackup}
              onCheckedChange={setEncryptBackup}
              className="data-[state=checked]:bg-destructive"
            />
          </div>

          {encryptBackup && (
            <div className="space-y-1 animate-in fade-in duration-300">
              <label className="text-[11px] font-semibold text-foreground">
                离线全文件核心密钥
              </label>
              <Input
                type="text"
                autoComplete="off"
                spellCheck={false}
                autoCorrect="off"
                value={backupPass}
                onChange={(e) => setBackupPass(e.target.value)}
                placeholder="务必牢记，否则无法恢复..."
                className="h-9 placeholder:text-muted-foreground/50 bg-background border-destructive/30 focus-visible:ring-destructive/40 text-xs font-mono"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 text-xs font-bold pt-1">
            <button
              onClick={handleExportLocalDataBackup}
              className="bg-background hover:bg-muted border border-border shadow-sm text-foreground py-2 rounded-md transition flex justify-center items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5 text-primary" />{" "}
              包裹归档提取
            </button>
            <label className="bg-background hover:bg-muted border border-border shadow-sm text-foreground py-2 rounded-md transition flex justify-center items-center gap-1.5 cursor-pointer">
              <Upload className="w-3.5 h-3.5 text-emerald-500" />{" "}
              还原覆盖数据
              <input
                type="file"
                onChange={handleImportLocalDataBackup}
                accept=".backup,.json,.jsonl,.txt,.bin,application/json,text/plain"
                className="hidden"
              />
            </label>
          </div>

          {backupStatus && (
            <div className="bg-background border border-border rounded p-2 text-[10px] text-muted-foreground text-center font-mono animate-in fade-in zoom-in-95 duration-200">
              {backupStatus}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
