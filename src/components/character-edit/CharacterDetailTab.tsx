import { CharacterCard } from "../../types";
import { compressImage } from "../../utils/imageCompressor";

export interface CharacterDetailTabProps {
  editingChar: Partial<CharacterCard>;
  setEditingChar: (char: Partial<CharacterCard> | null) => void;
  showCustomAlert: (msg: string) => void;
}

export default function CharacterDetailTab({
  editingChar,
  setEditingChar,
  showCustomAlert,
}: CharacterDetailTabProps) {
  return (
    <div className="p-4 space-y-3.5 text-xs">
      <div>
        <label className="block text-muted-foreground mb-1 font-bold">
          角色名称 *
        </label>
        <input
          type="text"
          placeholder="如: 艾莉娅"
          value={editingChar.name || ""}
          onChange={(e) =>
            setEditingChar({ ...editingChar, name: e.target.value })
          }
          className="w-full bg-input border border-border rounded p-2 text-foreground outline-none text-xs"
        />
      </div>

      <div>
        <label className="block text-muted-foreground mb-1">
          形象设计 URL (支持 base64 或者在线图片)
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="data:image/png;base64,... 或 http://..."
            value={editingChar.avatar || ""}
            onChange={(e) =>
              setEditingChar({
                ...editingChar,
                avatar: e.target.value,
              })
            }
            className="flex-1 bg-input border border-border rounded p-2 text-foreground outline-none text-xs truncate"
          />
          <label className="bg-muted text-muted-foreground px-3 rounded flex items-center justify-center cursor-pointer border border-border">
            上传
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  if (file.size > 5 * 1024 * 1024) {
                    showCustomAlert("⚠️ 上传失败：头像图片大小不能超过 5MB！");
                    return;
                  }
                  compressImage(file, 400, 400, 0.8, "image/png")
                    .then((base64) => {
                      setEditingChar({
                        ...editingChar,
                        avatar: base64,
                      });
                    })
                    .catch((err) => {
                      showCustomAlert("⚠️ 图片压缩失败：" + err.message);
                    });
                };
              }}
            />
          </label>
        </div>
      </div>

      <div>
        <label className="block text-muted-foreground mb-1">
          专属聊天背景图片 (支持 base64 或在线图片，优先渲染)
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="未设置（将使用全局背景或默认主题底色）"
            value={editingChar.visualSettings?.backgroundImageUrl || ""}
            onChange={(e) =>
              setEditingChar({
                ...editingChar,
                visualSettings: {
                  ...(editingChar.visualSettings || {}),
                  backgroundImageUrl: e.target.value,
                },
              })
            }
            className="flex-1 bg-input border border-border rounded p-2 text-foreground outline-none text-xs truncate"
          />
          <label className="bg-muted text-muted-foreground px-3 rounded flex items-center justify-center cursor-pointer border border-border shrink-0 select-none">
            上传
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  if (file.size > 5 * 1024 * 1024) {
                    showCustomAlert("⚠️ 上传失败：背景图片大小不能超过 5MB！");
                    return;
                  }
                  compressImage(file, 1080, 1920, 0.75, "image/jpeg")
                    .then((base64) => {
                      setEditingChar({
                        ...editingChar,
                        visualSettings: {
                          ...(editingChar.visualSettings || {}),
                          backgroundImageUrl: base64,
                        },
                      });
                    })
                    .catch((err) => {
                      showCustomAlert("⚠️ 图片压缩失败：" + err.message);
                    });
                }
              }}
            />
          </label>
          {editingChar.visualSettings?.backgroundImageUrl && (
            <button
              type="button"
              onClick={() =>
                setEditingChar({
                  ...editingChar,
                  visualSettings: {
                    ...(editingChar.visualSettings || {}),
                    backgroundImageUrl: "",
                  },
                })
              }
              className="bg-rose-950/20 text-red-400 px-3 rounded border border-rose-900/35 hover:bg-rose-950/45 transition shrink-0"
            >
              清除
            </button>
          )}
        </div>
      </div>

      <div>
        <label className="block text-muted-foreground mb-1">
          星号动作分色渲染 (角色级覆写)
        </label>
        <select
          value={
            editingChar.visualSettings?.enableAsteriskFormatting === undefined
              ? "inherit"
              : editingChar.visualSettings.enableAsteriskFormatting
              ? "true"
              : "false"
          }
          onChange={(e) => {
            const val = e.target.value;
            const updatedVisualSettings = {
              ...(editingChar.visualSettings || {}),
            };
            if (val === "inherit") {
              delete updatedVisualSettings.enableAsteriskFormatting;
            } else {
              updatedVisualSettings.enableAsteriskFormatting = val === "true";
            }
            setEditingChar({
              ...editingChar,
              visualSettings: updatedVisualSettings,
            });
          }}
          className="w-full bg-input border border-border rounded p-2 text-foreground outline-none text-xs"
        >
          <option value="inherit">跟随全局设置</option>
          <option value="true">强制启用</option>
          <option value="false">强制禁用</option>
        </select>
      </div>


      <div>
        <label className="block text-muted-foreground mb-1">
          人设描述 (Description/Persona)
        </label>
        <textarea
          placeholder="角色的详细描述、性格或背景设定..."
          rows={12}
          value={editingChar.description || ""}
          onChange={(e) =>
            setEditingChar({
              ...editingChar,
              description: e.target.value,
            })
          }
          className="w-full bg-input border border-border rounded p-2 text-foreground outline-none text-sm resize-y leading-relaxed"
        />
      </div>

      <div>
        <label className="block text-muted-foreground mb-1">
          性格词条细化 (Personality Description)
        </label>
        <input
          type="text"
          placeholder="角色的核心性格特征"
          value={editingChar.personality || ""}
          onChange={(e) =>
            setEditingChar({
              ...editingChar,
              personality: e.target.value,
            })
          }
          className="w-full bg-input border border-border rounded p-2 text-foreground outline-none text-xs"
        />
      </div>

      <div>
        <label className="block text-muted-foreground mb-1">
          当前剧本故事场景设定 (Scenario Context)
        </label>
        <input
          type="text"
          placeholder="当前的故事场景 and 环境设定"
          value={editingChar.scenario || ""}
          onChange={(e) =>
            setEditingChar({
              ...editingChar,
              scenario: e.target.value,
            })
          }
          className="w-full bg-input border border-border rounded p-2 text-foreground outline-none text-xs"
        />
      </div>

      <div>
        <label className="block text-muted-foreground mb-1">
          开场问候语 * (First message/Greeting)
        </label>
        <textarea
          placeholder="角色出场的第一句话"
          rows={12}
          value={editingChar.first_mes || ""}
          onChange={(e) =>
            setEditingChar({
              ...editingChar,
              first_mes: e.target.value,
            })
          }
          className="w-full bg-input border border-border rounded p-2 text-foreground outline-none text-sm resize-y leading-relaxed"
        />
      </div>

      <div>
        <label className="block text-muted-foreground mb-1">
          对白例句款式组 (Dialogue Examples)
        </label>
        <textarea
          placeholder="<user>: 你是谁？\n<char>: 我是..."
          rows={10}
          value={editingChar.mes_example || ""}
          onChange={(e) =>
            setEditingChar({
              ...editingChar,
              mes_example: e.target.value,
            })
          }
          className="w-full bg-input border border-border rounded p-2 text-foreground outline-none text-sm resize-y font-mono"
        />
      </div>

      <div>
        <label className="block text-muted-foreground mb-1">
          自定义系统提示约束 (System Instruction constraint Override)
        </label>
        <input
          type="text"
          placeholder="可选的系统级别提示词覆盖约定"
          value={editingChar.system_prompt || ""}
          onChange={(e) =>
            setEditingChar({
              ...editingChar,
              system_prompt: e.target.value,
            })
          }
          className="w-full bg-input border border-border rounded p-2 text-foreground outline-none text-xs hover:border-primary transition"
        />
      </div>
    </div>
  );
}
