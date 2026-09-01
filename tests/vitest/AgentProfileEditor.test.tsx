import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import AgentProfileEditor from "../../src/components/plugins/AgentProfileEditor";
import type { RuntimeProfileRecord } from "../../src/application/runtimeProfiles/contracts";
import { DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";

const profile: RuntimeProfileRecord = {
  id: "user.profile.editor",
  name: "编辑测试",
  schemaVersion: 1,
  version: 1,
  builtin: false,
  capabilities: {
    sillyTavernCompatibility: false,
    audioAsrFallback: true,
    videoKeyframeFallback: true,
  },
  agent: {
    toolMounts: [
      { name: "character.read", version: "1.0.0" },
      { name: "session.branch", version: "1.0.0" },
    ],
  },
  createdAt: 1,
  updatedAt: 1,
};

describe("AgentProfileEditor", () => {
  it("按角色、Tool、行为的引导顺序保存小型 Agent 配置", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    render(
      <AgentProfileEditor
        profile={profile}
        characters={[{
          id: "character-guide",
          name: "向导",
          description: "",
          personality: "",
          scenario: "",
          first_mes: "你好",
          mes_example: "",
        }]}
        promptPresets={[{
          id: "preset-guide",
          preset: { ...DEFAULT_SETTINGS.preset, id: "sampler-guide", name: "向导行为" },
          promptConfig: DEFAULT_SETTINGS.promptConfig,
        }]}
        fallbackSampling={DEFAULT_SETTINGS.preset}
        tools={profile.agent?.toolMounts ?? []}
        busy={false}
        onSave={onSave}
        onSaveAndStart={vi.fn(async () => undefined)}
      />,
    );

    await user.selectOptions(screen.getByRole("combobox", { name: /1\. 角色/ }), "character-guide");
    await user.click(screen.getByRole("checkbox", { name: /session\.branch/i }));
    await user.selectOptions(screen.getByRole("combobox", { name: /3\. 行为预设/ }), "preset-guide");
    await user.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      characterId: "character-guide",
      promptPresetId: "preset-guide",
      toolMounts: [{ name: "character.read", version: "1.0.0" }],
      sampling: undefined,
    }));
  });

  it("内置 Profile 保持只读并引导先复制", () => {
    render(
      <AgentProfileEditor
        profile={{ ...profile, id: "mobile-tavern.base", builtin: true }}
        characters={[]}
        promptPresets={[]}
        fallbackSampling={DEFAULT_SETTINGS.preset}
        tools={profile.agent?.toolMounts ?? []}
        busy={false}
        onSave={vi.fn(async () => undefined)}
        onSaveAndStart={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByText("内置 Profile 为只读模板。先点击“复制”，再编辑副本。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存配置" })).not.toBeInTheDocument();
  });
});
