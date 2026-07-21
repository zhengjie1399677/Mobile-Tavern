import React, { useState, useEffect } from "react";
import { Plus, Trash2, Check, AlertCircle } from "lucide-react";

interface MvuVariablesTabContentProps {
  variables: any;
  onSave: (newVars: any) => Promise<void>;
}

export const MvuVariablesTabContent: React.FC<MvuVariablesTabContentProps> = ({
  variables,
  onSave,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<"form" | "json">("form");
  const [statData, setStatData] = useState<any>({});
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Initialize from props
  useEffect(() => {
    const rawStat = variables?.stat_data || {};
    setStatData(JSON.parse(JSON.stringify(rawStat)));
    setJsonText(JSON.stringify(rawStat, null, 2));
    setJsonError(null);
  }, [variables]);

  // Handle Form field update
  const handleUpdateField = (path: string[], value: any) => {
    const updated = JSON.parse(JSON.stringify(statData));
    let current = updated;
    for (let i = 0; i < path.length - 1; i++) {
      current = current[path[i]];
    }
    current[path[path.length - 1]] = value;
    setStatData(updated);
    setJsonText(JSON.stringify(updated, null, 2));
  };

  // Handle Form delete field
  const handleDeleteField = (path: string[]) => {
    const updated = JSON.parse(JSON.stringify(statData));
    let current = updated;
    for (let i = 0; i < path.length - 1; i++) {
      current = current[path[i]];
    }
    delete current[path[path.length - 1]];
    setStatData(updated);
    setJsonText(JSON.stringify(updated, null, 2));
  };

  // Handle adding new variable at path
  const [newKey, setNewKey] = useState("");
  const [newValType, setNewValType] = useState<"string" | "number" | "boolean">("string");
  const [addingToPath, setAddingToPath] = useState<string[] | null>(null);

  const handleAddField = (path: string[]) => {
    if (!newKey.trim()) return;
    const key = newKey.trim();
    const updated = JSON.parse(JSON.stringify(statData));
    let current = updated;
    for (let i = 0; i < path.length; i++) {
      current = current[path[i]];
    }
    if (current[key] !== undefined) return; // avoid duplicate

    let defaultValue: any = "";
    if (newValType === "number") defaultValue = 0;
    if (newValType === "boolean") defaultValue = false;

    current[key] = defaultValue;
    setStatData(updated);
    setJsonText(JSON.stringify(updated, null, 2));
    setNewKey("");
    setAddingToPath(null);
  };

  // Handle saving
  const handleSave = async () => {
    let finalStat = statData;
    if (activeSubTab === "json") {
      try {
        finalStat = JSON.parse(jsonText);
        setJsonError(null);
      } catch (err: any) {
        setJsonError("JSON 格式错误: " + err.message);
        return;
      }
    }
    const nextVars = {
      ...variables,
      stat_data: finalStat,
    };
    await onSave(nextVars);
  };

  // Recursive form renderer
  const renderFields = (data: any, path: string[] = []): React.ReactNode => {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return null;
    }

    return (
      <div className="space-y-3 pl-2.5 border-l border-border/40">
        {Object.keys(data).map((key) => {
          const val = data[key];
          const currentPath = [...path, key];
          const isObject = val !== null && typeof val === "object" && !Array.isArray(val);

          if (isObject) {
            return (
              <div key={key} className="space-y-1.5 mt-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-primary font-mono">{key}</span>
                  <button
                    onClick={() => handleDeleteField(currentPath)}
                    className="p-1 rounded text-destructive hover:bg-destructive/10 transition shrink-0"
                    title="删除嵌套分类"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {renderFields(val, currentPath)}
              </div>
            );
          }

          // Render primitive
          return (
            <div key={key} className="flex items-center gap-2 text-xs bg-muted/20 border border-border/40 p-2 rounded-xl">
              <span className="font-semibold text-foreground/80 font-mono truncate min-w-[80px]" title={key}>
                {key}
              </span>
              
              <div className="flex-1 min-w-0 flex items-center gap-1.5">
                {typeof val === "number" ? (
                  <div className="flex items-center border border-border rounded-lg overflow-hidden bg-background">
                    <button
                      onClick={() => handleUpdateField(currentPath, val - 1)}
                      className="px-2 py-1 bg-muted hover:bg-muted/80 text-foreground font-mono font-bold"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      value={val}
                      onChange={(e) => handleUpdateField(currentPath, Number(e.target.value))}
                      className="w-16 text-center text-xs bg-transparent border-0 focus:outline-none focus:ring-0 p-1 font-mono"
                    />
                    <button
                      onClick={() => handleUpdateField(currentPath, val + 1)}
                      className="px-2 py-1 bg-muted hover:bg-muted/80 text-foreground font-mono font-bold"
                    >
                      +
                    </button>
                  </div>
                ) : typeof val === "boolean" ? (
                  <select
                    value={val ? "true" : "false"}
                    onChange={(e) => handleUpdateField(currentPath, e.target.value === "true")}
                    className="bg-background border border-border text-xs rounded-lg px-2 py-1 outline-none"
                  >
                    <option value="true">真 (True)</option>
                    <option value="false">假 (False)</option>
                  </select>
                ) : (
                  <input
                    type="text"
                    value={val || ""}
                    onChange={(e) => handleUpdateField(currentPath, e.target.value)}
                    className="flex-grow bg-background border border-border text-xs rounded-lg px-2 py-1 outline-none"
                  />
                )}
              </div>

              <button
                onClick={() => handleDeleteField(currentPath)}
                className="p-1 rounded text-destructive hover:bg-destructive/10 transition shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}

        {/* Inline Add Field Trigger */}
        {addingToPath && addingToPath.join(".") === path.join(".") ? (
          <div className="flex flex-wrap items-center gap-1.5 p-2 bg-muted/40 rounded-xl border border-border/50">
            <input
              type="text"
              placeholder="键名"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              className="text-xs bg-background border border-border rounded px-1.5 py-0.5 w-24 focus:outline-none"
            />
            <select
              value={newValType}
              onChange={(e: any) => setNewValType(e.target.value)}
              className="text-xs bg-background border border-border rounded px-1.5 py-0.5 focus:outline-none"
            >
              <option value="string">文本</option>
              <option value="number">数字</option>
              <option value="boolean">布尔</option>
            </select>
            <button
              onClick={() => handleAddField(path)}
              className="px-2 py-0.5 bg-primary text-primary-foreground text-[10px] font-bold rounded hover:bg-primary/95 shadow-sm"
            >
              确定
            </button>
            <button
              onClick={() => setAddingToPath(null)}
              className="px-2 py-0.5 border border-border text-[10px] rounded text-muted-foreground hover:bg-muted"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              setNewKey("");
              setAddingToPath(path);
            }}
            className="text-[10px] font-bold text-primary/80 hover:text-primary flex items-center gap-0.5 transition pl-2"
          >
            <Plus className="w-3.5 h-3.5" /> 添加新属性
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="flex min-h-full flex-col gap-3">
      {/* Sub Tabs */}
      <div className="flex shrink-0 gap-1 rounded-lg bg-muted/30 p-1 text-[11px] font-bold">
        <button
          onClick={() => setActiveSubTab("form")}
          className={`min-h-8 flex-1 rounded-md border transition ${
            activeSubTab === "form" ? "border-primary/25 bg-background text-primary shadow-sm" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          表单编辑
        </button>
        <button
          onClick={() => setActiveSubTab("json")}
          className={`min-h-8 flex-1 rounded-md border transition ${
            activeSubTab === "json" ? "border-primary/25 bg-background text-primary shadow-sm" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          JSON 源码
        </button>
      </div>

      <div className="min-h-0 flex-grow pr-1">
        {activeSubTab === "form" ? (
          Object.keys(statData).length === 0 ? (
            <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-border/70 px-5 py-6 text-center text-xs text-muted-foreground">
              当前无变量属性，点击下方「添加新属性」按钮新增。
            </div>
          ) : (
            renderFields(statData)
          )
        ) : (
          <div className="space-y-2 h-full flex flex-col">
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              className="w-full flex-grow min-h-[25vh] bg-muted/20 border border-border/80 rounded-xl p-3 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/20 text-foreground"
              placeholder="请输入标准格式的 JSON 字符串..."
            />
            {jsonError && (
              <div className="text-[10px] font-bold text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-2.5 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{jsonError}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="sticky bottom-0 flex shrink-0 justify-end gap-2 border-t border-border/30 bg-background/95 pt-2 backdrop-blur">
        {activeSubTab === "json" && (
          <button
            onClick={() => {
              try {
                const parsed = JSON.parse(jsonText);
                setJsonText(JSON.stringify(parsed, null, 2));
                setJsonError(null);
              } catch (err: any) {
                setJsonError("格式化失败: " + err.message);
              }
            }}
            className="text-xs font-bold border border-border hover:bg-muted text-muted-foreground px-3 py-2 rounded-xl transition"
          >
            格式化
          </button>
        )}
        <button
          onClick={handleSave}
          className="text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/95 px-4 py-2 rounded-xl shadow-sm transition flex items-center gap-1"
        >
          <Check className="w-4 h-4" /> 保存修改
        </button>
      </div>
    </div>
  );
};
