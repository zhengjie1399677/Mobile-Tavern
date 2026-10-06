/**
 * ApiConfigSection 通道档案编辑语义回归（2026-10-06）。
 *
 * 背景缺陷：档案只有“另存”，没有写回当前档案的路径；且编辑 Base URL / API Key 会
 * 立刻清空 `currentApiProfileId`，用户以为在编辑“档案 B”，实际改的是临时表单，
 * 再点“另存”就复制出内容一模一样的第二条档案，看起来像两条档案被合并。
 *
 * 覆盖：
 *  - 编辑 API Key 后档案选择保持不变，并出现“未保存”标记
 *  - 点“保存修改到当前通道”把表单写回档案，标记消失
 *  - 有未保存修改时切换档案先确认；取消则不切换
 */
import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ApiConfigSection from "../../src/tabs/settings/sections/ApiConfigSection";
import { Accordion } from "../../components/ui/accordion";
import { LanguageProvider } from "../../src/contexts/LanguageContext";
import { DEFAULT_SETTINGS } from "../../src/hooks/settings/defaults";
import type { ApiProfile, UserSettings } from "../../src/types";

const primaryProfile: ApiProfile = {
  id: "profile_primary",
  name: "DeepSeek 主",
  type: "openai-compat",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "sk-primary",
  modelName: "deepseek-chat",
  chatPath: "/chat/completions",
  reasoningStrength: "auto",
};

const relayProfile: ApiProfile = {
  id: "profile_relay",
  name: "中转站",
  type: "openai-compat",
  baseUrl: "https://relay.example.com/v1",
  apiKey: "sk-relay",
  modelName: "gpt-4o",
  chatPath: "/chat/completions",
  reasoningStrength: "auto",
};

function makeSettings(): UserSettings {
  return {
    ...DEFAULT_SETTINGS,
    api: {
      ...DEFAULT_SETTINGS.api,
      type: "openai-compat",
      baseUrl: primaryProfile.baseUrl,
      apiKey: primaryProfile.apiKey,
      modelName: primaryProfile.modelName,
      chatPath: primaryProfile.chatPath,
      reasoningStrength: "auto",
    },
    savedApiProfiles: [primaryProfile, relayProfile],
    currentApiProfileId: primaryProfile.id,
  };
}

interface HarnessProps {
  onConfirm?: (message: string) => Promise<boolean>;
}

function Harness({ onConfirm }: HarnessProps) {
  const [settings, setSettings] = useState<UserSettings>(makeSettings);
  const updateSettings = (next: UserSettings | ((prev: UserSettings) => UserSettings)) => {
    setSettings((prev) => (typeof next === "function" ? next(prev) : next));
  };

  return (
    <LanguageProvider>
      <Accordion defaultValue={["api-config"]}>
        <ApiConfigSection
          settings={settings}
          updateSettings={updateSettings}
          availableModels={[]}
          isFetchingModels={false}
          handleFetchModels={vi.fn()}
          testApiConnection={vi.fn()}
          connectionStatus={{ testing: false }}
          showCustomPrompt={vi.fn(async () => null)}
          showCustomConfirm={vi.fn(onConfirm ?? (async () => true))}
          saveState="idle"
          freeCount={0}
        />
      </Accordion>
      {/* 探针：把权威状态暴露给断言，避免依赖界面文案 */}
      <div data-testid="probe-profile-id">{settings.currentApiProfileId}</div>
      <div data-testid="probe-form-base-url">{settings.api.baseUrl}</div>
      <div data-testid="probe-profile-key">{settings.savedApiProfiles?.[0]?.apiKey}</div>
    </LanguageProvider>
  );
}

function keyInput() {
  return screen.getByPlaceholderText("sk-...");
}

describe("ApiConfigSection 通道档案编辑", () => {
  beforeEach(() => {
    // LanguageProvider 从 localStorage 读取语言；固定为 zh-CN 以断言中文文案。
    localStorage.setItem("mobile_tavern_language", "zh-CN");
  });

  it("编辑 API Key 不再丢失档案选择，并提示未保存", async () => {
    render(<Harness />);

    fireEvent.change(keyInput(), { target: { value: "sk-edited" } });

    expect(screen.getByTestId("probe-profile-id").textContent).toBe(primaryProfile.id);
    expect(screen.getByTestId("probe-form-base-url").textContent).toBe(primaryProfile.baseUrl);
    expect(screen.getByText("未保存")).toBeTruthy();
    // 未点保存前档案本体不变
    expect(screen.getByTestId("probe-profile-key").textContent).toBe("sk-primary");
  });

  it("点保存把表单写回当前档案，未保存标记消失", async () => {
    render(<Harness />);

    fireEvent.change(keyInput(), { target: { value: "sk-edited" } });
    await userEvent.click(screen.getByRole("button", { name: "保存修改到当前通道" }));

    await waitFor(() => {
      expect(screen.getByTestId("probe-profile-key").textContent).toBe("sk-edited");
    });
    expect(screen.getByTestId("probe-profile-id").textContent).toBe(primaryProfile.id);
    expect(screen.queryByText("未保存")).toBeNull();
  });

  it("有未保存修改时切换档案先确认，取消则不切换", async () => {
    render(<Harness onConfirm={async () => false} />);

    fireEvent.change(keyInput(), { target: { value: "sk-edited" } });
    await userEvent.click(screen.getByRole("combobox", { name: /选择 API 配置通道/ }));
    await userEvent.click(screen.getByRole("option", { name: /中转站/ }));

    await waitFor(() => {
      expect(screen.getByTestId("probe-profile-id").textContent).toBe(primaryProfile.id);
    });
  });

  it("确认切换后应用目标档案并清除未保存标记", async () => {
    render(<Harness onConfirm={async () => true} />);

    fireEvent.change(keyInput(), { target: { value: "sk-edited" } });
    await userEvent.click(screen.getByRole("combobox", { name: /选择 API 配置通道/ }));
    await userEvent.click(screen.getByRole("option", { name: /中转站/ }));

    await waitFor(() => {
      expect(screen.getByTestId("probe-profile-id").textContent).toBe(relayProfile.id);
    });
    expect(screen.getByTestId("probe-form-base-url").textContent).toBe(relayProfile.baseUrl);
    expect(screen.queryByText("未保存")).toBeNull();
  });
});
