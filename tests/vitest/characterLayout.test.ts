import { describe, expect, it, vi } from "vitest";
import {
  CHARACTER_LAYOUT_STORAGE_KEY,
  readCharacterLayout,
  saveCharacterLayout,
} from "../../src/tabs/characterLayout";

describe("角色目录布局偏好", () => {
  it("缺失或损坏的偏好回退到列表布局", () => {
    expect(readCharacterLayout({ getItem: () => null })).toBe("list");
    expect(readCharacterLayout({ getItem: () => "unknown" })).toBe("list");
  });

  it("读取并保存书架与双列大卡布局", () => {
    expect(readCharacterLayout({ getItem: () => "shelf" })).toBe("shelf");
    expect(readCharacterLayout({ getItem: () => "showcase" })).toBe("showcase");

    const setItem = vi.fn();
    saveCharacterLayout({ setItem }, "showcase");
    expect(setItem).toHaveBeenCalledWith(CHARACTER_LAYOUT_STORAGE_KEY, "showcase");
  });
});
