import React, { useState, useEffect, useMemo } from "react";
import { FolderSearch, X, Search, FileJson, Image, Loader2, ShieldAlert, CheckCircle } from "lucide-react";
import { useApp } from "../contexts/AppContext";
import { useCharactersState } from "../contexts/CharacterContext";
import { parseCharacterFile } from "../utils/cardParser";
import { catbotEventBus } from "../utils/catbotEventBus";
import { CharacterCard } from "../types";

// Android 原生桥接接口定义
interface AndroidThemeBridge {
  hasStoragePermission(): boolean;
  requestStoragePermission(): void;
  scanGlobalCards(): string;
  readLocalFile(path: string): string;
}

interface WindowWithAndroidBridge extends Window {
  AndroidThemeBridge?: AndroidThemeBridge;
}

// 辅助函数：将 Base64 Data URL 转换为 JS File 对象
function base64ToFile(base64Data: string, filename: string): File {
  const arr = base64Data.split(",");
  const mime = arr[0].match(/:(.*?);/)?.[1] || "application/octet-stream";
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mime });
}

interface ScannedFile {
  name: string;
  path: string;
  size: number;
  lastModified: number;
}

interface LocalCardScannerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function LocalCardScanner({ isOpen, onClose }: LocalCardScannerProps) {
  const { showCustomAlert } = useApp();
  const { saveCharacter } = useCharactersState();

  const [isAndroid, setIsAndroid] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scannedFiles, setScannedFiles] = useState<ScannedFile[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [importingPath, setImportingPath] = useState<string | null>(null);

  // 检测是否为 Android 运行环境
  useEffect(() => {
    const bridge = (window as WindowWithAndroidBridge).AndroidThemeBridge;
    if (typeof window !== "undefined" && !!bridge) {
      setIsAndroid(true);
      const permitted = bridge.hasStoragePermission();
      setHasPermission(permitted);
    }
  }, [isOpen]);

  // 处理权限申请
  const handleRequestPermission = () => {
    const bridge = (window as WindowWithAndroidBridge).AndroidThemeBridge;
    if (typeof window !== "undefined" && bridge) {
      bridge.requestStoragePermission();
      
      // 循环轮询检查用户是否授予权限
      const timer = setInterval(() => {
        const permitted = (window as WindowWithAndroidBridge).AndroidThemeBridge?.hasStoragePermission() || false;
        if (permitted) {
          setHasPermission(true);
          clearInterval(timer);
          // 授权成功后直接触发扫描
          triggerScan();
        }
      }, 1000);

      // 5秒后清除轮询防止后台无限消耗
      setTimeout(() => clearInterval(timer), 5000);
    }
  };

  // 触发安卓文件扫描
  const triggerScan = () => {
    const bridge = (window as WindowWithAndroidBridge).AndroidThemeBridge;
    if (typeof window === "undefined" || !bridge) return;
    setIsScanning(true);
    setTimeout(() => {
      try {
        const jsonStr = bridge.scanGlobalCards();
        const files: ScannedFile[] = JSON.parse(jsonStr || "[]");
        // 按最后修改时间降序排序（最新放在前面）
        files.sort((a, b) => b.lastModified - a.lastModified);
        setScannedFiles(files);
      } catch (err: any) {
        showCustomAlert("扫描失败: " + err.message);
      } finally {
        setIsScanning(false);
      }
    }, 400); // 略微延时让 Loading 动画平滑展现
  };

  // 模拟开发环境扫描 (浏览器测试)
  const triggerMockScan = () => {
    setIsScanning(true);
    setTimeout(() => {
      const mockData: ScannedFile[] = [
        {
          name: "芙宁娜_Furina_SillyTavern.png",
          path: "/storage/emulated/0/Download/Furina_SillyTavern.png",
          size: 154209,
          lastModified: Date.now() - 3600000 * 2,
        },
        {
          name: "影_Raiden_Shogun_Tavern.json",
          path: "/storage/emulated/0/Documents/Raiden_Shogun_Tavern.json",
          size: 45120,
          lastModified: Date.now() - 3600000 * 12,
        },
        {
          name: "纳西妲_Nahida_Card.png",
          path: "/storage/emulated/0/Pictures/Nahida_Card.png",
          size: 204911,
          lastModified: Date.now() - 3600000 * 24 * 3,
        },
        {
          name: "钟离_Zhongli_ST.json",
          path: "/storage/emulated/0/Download/Zhongli_ST.json",
          size: 12094,
          lastModified: Date.now() - 3600000 * 24 * 8,
        }
      ];
      setScannedFiles(mockData);
      setIsScanning(false);
    }, 800);
  };

  // 处理角色卡一键导入
  const handleImportFile = async (file: ScannedFile) => {
    if (importingPath) return; // 避免并发重复导入
    setImportingPath(file.path);

    try {
      let content = "";
      const bridge = (window as WindowWithAndroidBridge).AndroidThemeBridge;
      if (typeof window !== "undefined" && bridge) {
        content = bridge.readLocalFile(file.path);
        if (content.startsWith("error:")) {
          throw new Error(content.substring(6));
        }
      } else {
        // 开发环境模拟成功读取
        await new Promise((resolve) => setTimeout(resolve, 600));
        if (file.name.endsWith(".json")) {
          content = JSON.stringify({
            name: file.name.split("_")[0],
            description: "模拟环境导入的 JSON 角色卡描述",
            personality: "温和冷静",
          });
        } else {
          // PNG 图片模拟
          content = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
        }
      }

      // 将文件还原为 File 对象
      let jsFile: File;
      if (file.name.endsWith(".png")) {
        jsFile = base64ToFile(content, file.name);
      } else {
        jsFile = new File([content], file.name, { type: "application/json" });
      }

      const parsedData = await parseCharacterFile(jsFile);
      const importedChar: CharacterCard = {
        id: "char_ST_" + Math.random().toString(36).substring(2, 9),
        name: parsedData.name || "导入角色",
        avatar: parsedData.avatar || "",
        description: parsedData.description || "",
        personality: parsedData.personality || "",
        scenario: parsedData.scenario || "",
        first_mes: parsedData.first_mes || "",
        mes_example: parsedData.mes_example || "",
        system_prompt: parsedData.system_prompt || "",
        post_history_instructions: parsedData.post_history_instructions || "",
        alternate_greetings: parsedData.alternate_greetings || [],
        lorebookEntries: parsedData.lorebookEntries || [],
        isWorldbookGlobal: false,
        creator: parsedData.creator || "",
        creator_notes: parsedData.creator_notes || "",
        tags: parsedData.tags || [],
        character_version: parsedData.character_version || "1.0.0",
        extensions: parsedData.extensions || {},
        visualSettings: parsedData.visualSettings,
      };

      await saveCharacter(importedChar);
      catbotEventBus.emit("character_imported");
      showCustomAlert(`导入成功: "${importedChar.name}" 角色卡已成功加载！`);
      
      // 导入成功后，从本地扫描列表中剔除该文件
      setScannedFiles((prev) => prev.filter((f) => f.path !== file.path));
    } catch (err: any) {
      showCustomAlert("文件导入失败: " + err.message);
    } finally {
      setImportingPath(null);
    }
  };

  // 搜索关键字过滤
  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return scannedFiles;
    const query = searchQuery.toLowerCase();
    return scannedFiles.filter((f) => f.name.toLowerCase().includes(query));
  }, [scannedFiles, searchQuery]);

  // 格式化文件大小
  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[999] flex items-center justify-center p-4">
      <div className="bg-background border border-border rounded-2xl w-full max-w-lg flex flex-col h-[85vh] max-h-[640px] shadow-2xl overflow-hidden text-xs">
        
        {/* 头部标题区 */}
        <div className="flex items-center justify-between border-b border-border p-3.5 shrink-0">
          <h4 className="font-bold text-foreground flex items-center gap-2 text-sm">
            <FolderSearch className="w-4.5 h-4.5 text-primary" />
            <span>检索并导入手机本地角色卡</span>
          </h4>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="text-muted-foreground hover:text-foreground hover:bg-muted/40 p-1 rounded-lg transition active:scale-95"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* 核心扫描操纵区 */}
        <div className="p-3 bg-muted/20 border-b border-border shrink-0 space-y-2.5">
          {!isAndroid ? (
            /* 非安卓浏览器环境下的调试指示 */
            <div className="bg-primary/5 border border-primary/20 p-2.5 rounded-xl space-y-1.5 leading-relaxed text-muted-foreground">
              <div className="flex items-center gap-1.5 font-bold text-primary">
                <CheckCircle className="w-3.5 h-3.5" />
                <span>浏览器沙盒模拟环境</span>
              </div>
              <p className="text-[10px]">
                当前运行在 Web 开发调试模式下。为了验证交互界面与导入逻辑，您可以点击下方按钮模拟检索出测试卡片。
              </p>
              <button
                type="button"
                onClick={triggerMockScan}
                disabled={isScanning}
                className="w-full py-1.5 bg-primary hover:bg-primary/95 text-primary-foreground font-bold rounded-lg transition active:scale-[0.98] flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {isScanning ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>正在模拟扫描...</span>
                  </>
                ) : (
                  <span>模拟扫描手机存储 (Scan Files)</span>
                )}
              </button>
            </div>
          ) : !hasPermission ? (
            /* 安卓无权限申请引导 */
            <div className="bg-destructive/10 border border-destructive/20 p-3 rounded-xl space-y-2">
              <div className="flex items-center gap-2 font-bold text-destructive">
                <ShieldAlert className="w-4 h-4" />
                <span>需要外部存储访问权限</span>
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                App 需要读取您的外部存储（如 Downloads 目录）以检索存放在那里的角色卡。您可以随时关闭或在手机设置中撤销此权限。
              </p>
              <button
                type="button"
                onClick={handleRequestPermission}
                className="w-full py-2 bg-primary hover:bg-primary/95 text-primary-foreground font-bold rounded-lg transition active:scale-[0.98]"
              >
                授权并扫描本地卡片
              </button>
            </div>
          ) : (
            /* 已授权安卓主扫描控制键 */
            <button
              type="button"
              onClick={triggerScan}
              disabled={isScanning}
              className="w-full py-2 bg-primary hover:bg-primary/95 text-primary-foreground font-bold rounded-lg transition active:scale-[0.98] flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {isScanning ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>检索存储介质中...</span>
                </>
              ) : (
                <>
                  <FolderSearch className="w-3.5 h-3.5" />
                  <span>立即扫描 Download & Pictures 目录</span>
                </>
              )}
            </button>
          )}

          {/* 实时搜索过滤框 */}
          {scannedFiles.length > 0 && (
            <div className="relative">
              <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-muted-foreground/70" />
              <input
                type="text"
                placeholder="搜索已扫描出的本地卡片文件..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-2.5 py-1.5 bg-input border border-border rounded-lg text-[11px] text-foreground outline-none focus:border-primary transition"
              />
            </div>
          )}
        </div>

        {/* 扫描文件列表展现区 */}
        <div className="flex-1 overflow-y-auto p-3 custom-scrollbar space-y-2">
          {isScanning ? (
            <div className="h-full flex flex-col items-center justify-center space-y-2 text-muted-foreground py-16">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-[11px] font-medium animate-pulse">正在手机公共目录搜索卡片，请稍候...</p>
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center space-y-1.5 text-muted-foreground text-center py-16 leading-relaxed">
              <FolderSearch className="w-10 h-10 text-muted-foreground/30 stroke-[1.2]" />
              <p className="font-bold text-[11px]">暂无扫描结果</p>
              <p className="text-[10px] text-muted-foreground/80 max-w-xs">
                {scannedFiles.length > 0
                  ? "没有符合搜索关键字的文件。"
                  : "点击上方扫描按钮，检索您存放在手机中的 .json 角色包或酒馆 PNG 图片卡。"}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {filteredFiles.map((file) => {
                const isJson = file.name.endsWith(".json");
                const isImporting = importingPath === file.path;

                return (
                  <div
                    key={file.path}
                    className="flex items-center justify-between gap-3 p-2 bg-muted/30 hover:bg-muted/65 border border-border/40 rounded-xl transition duration-200"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="p-2 bg-background border border-border/50 rounded-lg text-primary">
                        {isJson ? (
                          <FileJson className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Image className="w-4 h-4 text-blue-400" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-foreground truncate text-[11.5px] leading-tight" title={file.name}>
                          {file.name}
                        </p>
                        <p className="text-[9px] text-muted-foreground truncate leading-tight mt-0.5" title={file.path}>
                          {file.path}
                        </p>
                        <p className="text-[8.5px] text-muted-foreground/75 leading-none mt-1">
                          大小: {formatSize(file.size)} | 修改时间: {new Date(file.lastModified).toLocaleDateString()}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isImporting || !!importingPath}
                      onClick={() => handleImportFile(file)}
                      className="px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-lg text-[10px] transition active:scale-95 disabled:opacity-50 shrink-0 flex items-center gap-1"
                    >
                      {isImporting ? (
                        <>
                          <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          <span>导入中</span>
                        </>
                      ) : (
                        <span>导入</span>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
