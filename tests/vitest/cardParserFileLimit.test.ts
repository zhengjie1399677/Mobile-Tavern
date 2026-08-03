import { describe, expect, it } from "vitest";
import {
  isCharacterCardFileSizeAllowed,
  MAX_CHARACTER_CARD_FILE_BYTES,
} from "../../src/utils/cardParser";

describe("角色卡文件大小限制", () => {
  it("允许最大 20 MB，并拒绝超过边界的文件", () => {
    expect(MAX_CHARACTER_CARD_FILE_BYTES).toBe(20 * 1024 * 1024);
    expect(isCharacterCardFileSizeAllowed(MAX_CHARACTER_CARD_FILE_BYTES)).toBe(true);
    expect(isCharacterCardFileSizeAllowed(MAX_CHARACTER_CARD_FILE_BYTES + 1)).toBe(false);
    expect(isCharacterCardFileSizeAllowed(0)).toBe(false);
  });
});
