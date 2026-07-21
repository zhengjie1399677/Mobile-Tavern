import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LocalCardScanner from "../../src/components/LocalCardScanner";

const mocks = vi.hoisted(() => ({
  showCustomAlert: vi.fn(),
  saveCharacter: vi.fn(),
}));

vi.mock("../../src/contexts/AppContext", () => ({
  useApp: () => ({ showCustomAlert: mocks.showCustomAlert }),
}));

vi.mock("../../src/contexts/CharacterContext", () => ({
  useCharactersState: () => ({ saveCharacter: mocks.saveCharacter }),
}));

vi.mock("../../src/contexts/LanguageContext", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

interface TestAndroidBridge {
  hasStoragePermission: ReturnType<typeof vi.fn>;
  requestStoragePermission: ReturnType<typeof vi.fn>;
  scanGlobalCards: ReturnType<typeof vi.fn>;
  readLocalFile: ReturnType<typeof vi.fn>;
}

const androidWindow = window as unknown as {
  AndroidThemeBridge?: TestAndroidBridge;
};

describe("LocalCardScanner Android 权限流程", () => {
  let bridge: TestAndroidBridge;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.showCustomAlert.mockReset();
    mocks.saveCharacter.mockReset();
    bridge = {
      hasStoragePermission: vi.fn(() => false),
      requestStoragePermission: vi.fn(),
      scanGlobalCards: vi.fn(() => "[]"),
      readLocalFile: vi.fn(() => ""),
    };
    androidWindow.AndroidThemeBridge = bridge;
  });

  afterEach(() => {
    delete androidWindow.AndroidThemeBridge;
    vi.useRealTimers();
  });

  it("拒绝或直接返回时停止等待且不扫描", () => {
    render(<LocalCardScanner isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "scanner.permission_btn" }));
    expect(bridge.requestStoragePermission).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("androidStoragePermissionResult", {
          detail: { granted: false },
        }),
      );
    });

    expect(bridge.scanGlobalCards).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "scanner.permission_btn" })).toBeEnabled();
  });

  it("授权成功后自动扫描并展示文件", async () => {
    bridge.scanGlobalCards.mockReturnValue(
      JSON.stringify([
        {
          name: "角色卡.json",
          path: "/storage/emulated/0/Download/角色卡.json",
          size: 1024,
          lastModified: 123,
        },
      ]),
    );
    render(<LocalCardScanner isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "scanner.permission_btn" }));
    act(() => {
      window.dispatchEvent(
        new CustomEvent("androidStoragePermissionResult", {
          detail: { granted: true },
        }),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(bridge.scanGlobalCards).toHaveBeenCalledTimes(1);
    expect(screen.getByText("角色卡.json")).toBeInTheDocument();
  });
});
