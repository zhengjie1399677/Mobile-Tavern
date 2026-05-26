const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// Add state for backup UI and encryptBackup
let stateOld = `  // Backups Encryption Passphrase
  const [backupPass, setBackupPass] = useState("");
  const [backupStatus, setBackupStatus] = useState<string>("");`;
let stateNew = `  // Backups Encryption Passphrase
  const [backupPass, setBackupPass] = useState("");
  const [backupStatus, setBackupStatus] = useState<string>("");
  const [encryptBackup, setEncryptBackup] = useState(true);
  const [showBackupUI, setShowBackupUI] = useState(false);`;
content = content.replace(stateOld, stateNew);

let exportOld = `  const handleExportLocalDataBackup = async () => {
    if (!backupPass.trim()) {
      await showCustomAlert("请预设一个强度适宜的数据保护密码。");
      return;
    }
    setBackupStatus("正在加密并创建备份文件...");
    try {
      const payloadObj = {
        characters,
        sessions,
        settings,
        globalLorebook,
        backupDate: new Date().toISOString()
      };
      const jsonStr = JSON.stringify(payloadObj);
      const encryptedHex = await encryptBackupData(jsonStr, backupPass.trim());

      const dataBlob = new Blob([encryptedHex], { type: "text/plain" });
      const downloadUrl = URL.createObjectURL(dataBlob);

      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = \`mobile_tavern_backup_\${new Date().toISOString().slice(0, 10)}.backup\`;
      link.click();
      setBackupStatus("备份文件创建并下载完成！");
    } catch (err: any) {
      setBackupStatus(\`加密备份崩溃: \${err.message}\`);
    }
  };

  const handleImportLocalDataBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!backupPass.trim()) {
      await showCustomAlert("请先输入加密备份文件的对应解码密码");
      e.target.value = "";
      return;
    }

    setBackupStatus("验证解码中...");
    try {
      const encryptedHex = await file.text();
      const decryptedJson = await decryptBackupData(encryptedHex, backupPass.trim());
      const parsed = JSON.parse(decryptedJson);`;

let exportNew = `  const handleExportLocalDataBackup = async () => {
    if (encryptBackup && !backupPass.trim()) {
      await showCustomAlert("开启了加密，请预设一个强度适宜的数据保护密码。");
      return;
    }
    setBackupStatus(encryptBackup ? "正在加密并创建备份文件..." : "正在创建明文备份...");
    try {
      const payloadObj = {
        characters,
        sessions,
        settings,
        globalLorebook,
        backupDate: new Date().toISOString(),
        isEncrypted: encryptBackup
      };
      const jsonStr = JSON.stringify(payloadObj);
      let outputData = jsonStr;
      
      if (encryptBackup) {
        outputData = await encryptBackupData(jsonStr, backupPass.trim());
      }

      const dataBlob = new Blob([outputData], { type: "text/plain" });
      const downloadUrl = URL.createObjectURL(dataBlob);

      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = \`mobile_tavern_backup_\${new Date().toISOString().slice(0, 10)}\${encryptBackup ? '.backup' : '.json'}\`;
      link.click();
      setBackupStatus("备份文件创建并下载完成！");
    } catch (err: any) {
      setBackupStatus(\`备份崩溃: \${err.message}\`);
    }
  };

  const handleImportLocalDataBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setBackupStatus("读取文件中...");
    try {
      const textData = await file.text();
      let parsed;
      // Simple heuristic for encrypted vs json
      if (textData.startsWith("{")) {
        parsed = JSON.parse(textData);
      } else {
        if (!backupPass.trim()) {
          await showCustomAlert("备份可能是加密文件，请先输入对应密码。");
          e.target.value = "";
          return;
        }
        setBackupStatus("验证解码中...");
        const decryptedJson = await decryptBackupData(textData, backupPass.trim());
        parsed = JSON.parse(decryptedJson);
      }`;

content = content.replace(exportOld, exportNew);

let historyListOld = `                        <div className="flex justify-between items-start">
                          <h4 className="font-bold text-sm truncate text-foreground">{s.title || "主剧情线"}</h4>
                          <span className="text-[9px] text-muted-foreground whitespace-nowrap pt-0.5">{new Date(s.createdAt).toLocaleDateString()}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate opacity-70">{char?.name || "未知角色"} | {s.messages.length} 回合对话</p>
                      </div>`;

let historyListNew = `                        <div className="flex justify-between items-start">
                          <h4 className="font-bold text-sm truncate text-foreground">{s.title || "主剧情线"}</h4>
                          <span className="text-[9px] text-muted-foreground whitespace-nowrap pt-0.5">{new Date(s.createdAt).toLocaleDateString()}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate opacity-70">
                          {char?.name || "未知角色"} | {s.messages.length} 回合 | {s.messages.reduce((total, msg) => total + msg.content.length, 0) > 1000 ? (s.messages.reduce((total, msg) => total + msg.content.length, 0) / 1000).toFixed(1) + "k" : s.messages.reduce((total, msg) => total + msg.content.length, 0)} 字
                        </p>
                      </div>`;
content = content.replace(historyListOld, historyListNew);


let offlineBackupUIOld = `                  <Card className="bg-card border-border shadow-sm border-dashed border-destructive/30">
                    <CardHeader className="pb-3 border-b border-border/50 bg-destructive/5">
                      <CardTitle className="text-sm flex items-center gap-2 text-destructive">
                        <Lock className="w-4 h-4" /> 离线密码密保备份底座
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4 space-y-4 bg-muted/10">
                      <p className="text-[10px] text-muted-foreground leading-relaxed">
                        本程序通过XOR强加密提供本地全生命周期数据保护。请设置并牢记口令。
                      </p>
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-semibold text-foreground">离线全文件核心密钥</label>
                        <Input
                          type="password"
                          value={backupPass}
                          onChange={(e) => setBackupPass(e.target.value)}
                          placeholder="Passphrase"
                          className="h-9 placeholder:text-muted-foreground/50 bg-input/40 border-destructive/30 focus-visible:ring-destructive/40 text-xs font-mono"
                        />
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2 text-xs font-bold pt-1">
                        <button onClick={handleExportLocalDataBackup} className="bg-card hover:bg-card/80 border border-border shadow-sm text-foreground py-2 rounded-md transition flex justify-center items-center gap-1.5">
                          <Download className="w-3.5 h-3.5 text-destructive" /> 包裹归档
                        </button>
                        <label className="bg-card hover:bg-card/80 border border-border shadow-sm text-foreground py-2 rounded-md transition flex justify-center items-center gap-1.5 cursor-pointer">
                          <Upload className="w-3.5 h-3.5 text-emerald-500" /> 还原替换
                          <input type="file" onChange={handleImportLocalDataBackup} accept=".backup" className="hidden" />
                        </label>
                      </div>
                      
                      {backupStatus && (
                        <div className="bg-background border border-border rounded p-2 text-[10px] text-muted-foreground text-center font-mono animate-in fade-in zoom-in-95 duration-200">
                          {backupStatus}
                        </div>
                      )}
                    </CardContent>
                  </Card>`;

let offlineBackupUINew = `                  <Card className="bg-card border-border shadow-sm">
                    <CardHeader 
                      className="py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => setShowBackupUI(!showBackupUI)}
                    >
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm flex items-center gap-2 text-foreground">
                          <Lock className="w-4 h-4 text-emerald-500" /> 离线数据全库备份/还原
                        </CardTitle>
                        <span className="text-muted-foreground text-xs">{showBackupUI ? "收起" : "展开"}</span>
                      </div>
                    </CardHeader>
                    {showBackupUI && (
                      <CardContent className="pt-4 space-y-4 bg-muted/10 border-t border-border/50 animate-in fade-in slide-in-from-top-2 duration-300">
                        <div className="flex items-center justify-between border-b border-border/50 pb-3">
                          <div className="flex flex-col">
                            <span className="text-sm font-semibold flex items-center gap-2 text-destructive">
                              加密导出保护 (XOR强加密)
                            </span>
                            <span className="text-[10px] text-muted-foreground mt-1">
                              推荐开启以防配置文件侧链泄露
                            </span>
                          </div>
                          <Switch 
                            checked={encryptBackup} 
                            onCheckedChange={setEncryptBackup} 
                            className="data-[state=checked]:bg-destructive" 
                          />
                        </div>

                        {encryptBackup && (
                          <div className="space-y-1.5 animate-in fade-in duration-300">
                            <label className="text-[11px] font-semibold text-foreground">离线全文件核心密钥</label>
                            <Input
                              type="password"
                              value={backupPass}
                              onChange={(e) => setBackupPass(e.target.value)}
                              placeholder="务必牢记，否则无法恢复..."
                              className="h-9 placeholder:text-muted-foreground/50 bg-background border-destructive/30 focus-visible:ring-destructive/40 text-xs font-mono"
                            />
                          </div>
                        )}
                        
                        <div className="grid grid-cols-2 gap-2 text-xs font-bold pt-1">
                          <button onClick={handleExportLocalDataBackup} className="bg-background hover:bg-muted border border-border shadow-sm text-foreground py-2 rounded-md transition flex justify-center items-center gap-1.5">
                            <Download className="w-3.5 h-3.5 text-primary" /> 包裹归档提取
                          </button>
                          <label className="bg-background hover:bg-muted border border-border shadow-sm text-foreground py-2 rounded-md transition flex justify-center items-center gap-1.5 cursor-pointer">
                            <Upload className="w-3.5 h-3.5 text-emerald-500" /> 还原覆盖数据
                            <input type="file" onChange={handleImportLocalDataBackup} accept=".backup,.json" className="hidden" />
                          </label>
                        </div>
                        
                        {backupStatus && (
                          <div className="bg-background border border-border rounded p-2 text-[10px] text-muted-foreground text-center font-mono animate-in fade-in zoom-in-95 duration-200">
                            {backupStatus}
                          </div>
                        )}
                      </CardContent>
                    )}
                  </Card>`;

content = content.replace(offlineBackupUIOld, offlineBackupUINew);


fs.writeFileSync('src/App.tsx', content);
