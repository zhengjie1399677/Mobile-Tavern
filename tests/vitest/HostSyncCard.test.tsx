/**
 * 宿主同步卡片的交互契约。
 *
 * 这里钉的不是样式，而是两个容易搞错的语义边界：默认必须是「合并」而不是「覆盖」
 * （后者会抹掉另一端独有的数据，不能是默认行为），以及「关闭合并预览」这个高级选项
 * 必须真的写进设置并被显式提示 —— 关掉它等于放弃落库前的最后一次拦截。
 *
 * 语言显式钉成 zh-CN：文案断言依赖具体译文，放任它跟随运行环境的 navigator.language
 * 会让用例在别的机器上因为语言不同而失败。
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { LanguageProvider } from "../../src/contexts/LanguageContext";
import HostSyncCard from "../../src/tabs/settings/sections/HostSyncCard";
import type { HostBindingSettings, UserSettings } from "../../src/types";

const BINDING: HostBindingSettings = {
  bindHost: "127.0.0.1",
  bindPort: 18080,
  accessKey: "",
  corsOrigins: "",
  remoteUrl: "192.168.1.10:18080",
  remoteAccessKey: "k",
};

function makeSettings(patch: Partial<HostBindingSettings> = {}): UserSettings {
  return { hostBinding: { ...BINDING, ...patch } } as unknown as UserSettings;
}

function renderCard(settings: UserSettings, overrides: Partial<{
  onNavigateToHost: () => void;
  handlePushToHost: () => Promise<void>;
  handlePullFromHost: () => Promise<void>;
}> = {}) {
  const updateSettings = vi.fn();
  render(
    <LanguageProvider>
      <HostSyncCard
        settings={settings}
        updateSettings={updateSettings}
        backupStatus=""
        handlePushToHost={overrides.handlePushToHost ?? vi.fn()}
        handlePullFromHost={overrides.handlePullFromHost ?? vi.fn()}
        onNavigateToHost={overrides.onNavigateToHost}
      />
    </LanguageProvider>,
  );
  return updateSettings;
}

/** 取出最后一次传给 updateSettings 的函数式更新器，算出它会把设置改成什么。 */
function applyUpdate(
  updateSettings: ReturnType<typeof vi.fn>,
  prev: UserSettings,
): UserSettings {
  const call = updateSettings.mock.calls.at(-1);
  expect(call, "updateSettings 未被调用").toBeTruthy();
  const action = call![0] as (value: UserSettings) => UserSettings;
  return action(prev);
}

/** 折叠头是可交互控件，按可访问名定位，顺带验证它确实是一个控件。 */
function header() {
  return screen.getByRole("button", { name: /宿主同步/ });
}

function expand() {
  const node = header();
  if (node.getAttribute("aria-expanded") !== "true") fireEvent.click(node);
  return node;
}

beforeEach(() => {
  localStorage.setItem("mobile_tavern_language", "zh-CN");
});

describe("HostSyncCard 同步方式", () => {
  it("未设置时默认合并，且头部徽标与分段控件都指向合并", () => {
    renderCard(makeSettings());
    expect(expand()).toHaveAttribute("aria-expanded", "true");

    // 两种语义都要显式可选，默认必须落在更安全的「合并」上
    expect(screen.getByRole("button", { name: "合并（推荐）", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "覆盖", pressed: false })).toBeInTheDocument();
    // 语义说明要跟着选择走，否则用户只能靠猜（desc 里也提到"求并集"，锚定提示专属尾句）
    expect(screen.getByText(/日常同步用这个/)).toBeInTheDocument();
  });

  it("显式选了覆盖时，按设置的语义渲染并给出覆盖后果", () => {
    renderCard(makeSettings({ syncMode: "replace" }));
    expand();

    expect(screen.getByRole("button", { name: "覆盖", pressed: true })).toBeInTheDocument();
    expect(screen.getByText(/覆盖会抹掉另一端独有/)).toBeInTheDocument();
  });

  it("切到覆盖时把 syncMode 写进设置，而不是只改本地状态", () => {
    const settings = makeSettings();
    const updateSettings = renderCard(settings);
    expand();

    fireEvent.click(screen.getByRole("button", { name: "覆盖", pressed: false }));

    const next = applyUpdate(updateSettings, settings);
    expect(next.hostBinding?.syncMode).toBe("replace");
    // 只改这两个开关，其余绑定配置必须原样带过去
    expect(next.hostBinding?.remoteUrl).toBe(BINDING.remoteUrl);
    expect(next.hostBinding?.bindPort).toBe(BINDING.bindPort);
  });

  it("设置里没有 hostBinding 时点击不写入半成品配置", () => {
    const settings = {} as UserSettings;
    const updateSettings = renderCard(settings);
    expand();

    fireEvent.click(screen.getByRole("button", { name: "覆盖", pressed: false }));

    const call = updateSettings.mock.calls.at(-1);
    const updater = call![0] as (value: UserSettings) => UserSettings;
    // 缺字段时宁可不改，也不凭猜测补一份残缺的绑定配置
    expect(updater(settings)).toBe(settings);
  });
});

describe("HostSyncCard 高级选项", () => {
  it("高级选项默认折叠，展开后预览开关默认开启", () => {
    renderCard(makeSettings());
    expand();

    const advanced = screen.getByRole("button", { name: /高级选项/ });
    expect(advanced).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("switch")).toBeNull();

    fireEvent.click(advanced);
    expect(advanced).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("switch")).toBeChecked();
  });

  it("关闭预览会写入设置", () => {
    const settings = makeSettings({ syncPreviewEnabled: true });
    const updateSettings = renderCard(settings);
    expand();

    fireEvent.click(screen.getByRole("button", { name: /高级选项/ }));
    fireEvent.click(screen.getByRole("switch"));

    const next = applyUpdate(updateSettings, settings);
    expect(next.hostBinding?.syncPreviewEnabled).toBe(false);
  });

  it("显式关闭预览时，开关呈关闭态并提示同步将直接执行", () => {
    renderCard(makeSettings({ syncPreviewEnabled: false }));
    expand();
    fireEvent.click(screen.getByRole("button", { name: /高级选项/ }));

    expect(screen.getByRole("switch")).not.toBeChecked();
    // 关掉预览等于放弃落库前的最后一次拦截，必须显式提示
    expect(screen.getByText(/点下按钮即执行同步/)).toBeInTheDocument();
  });
});

describe("HostSyncCard 未配置宿主", () => {
  it("动作按钮禁用，并给出前往配置的引导", () => {
    const onNavigateToHost = vi.fn();
    renderCard(makeSettings({ remoteUrl: "" }), { onNavigateToHost });
    expand();

    expect(screen.getByRole("button", { name: /推送到宿主/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /从宿主拉取/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /前往/ }));
    expect(onNavigateToHost).toHaveBeenCalledTimes(1);
  });
});

describe("HostSyncCard 折叠行为", () => {
  it("点击折叠头展开，且不会误触发同步", () => {
    const handlePushToHost = vi.fn();
    const handlePullFromHost = vi.fn();
    renderCard(makeSettings(), { handlePushToHost, handlePullFromHost });

    const node = header();
    expect(node).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(node);
    expect(node).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(node, { key: "Enter" });
    expect(node).toHaveAttribute("aria-expanded", "false");

    expect(handlePushToHost).not.toHaveBeenCalled();
    expect(handlePullFromHost).not.toHaveBeenCalled();
  });
});
