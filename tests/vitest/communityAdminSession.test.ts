import { beforeEach, describe, expect, it } from "vitest";
import {
  clearCommunityAdminToken,
  getCommunityAdminToken,
  isCommunityAdmin,
  setCommunityAdminToken,
} from "../../src/domain/community/adminSession";

describe("社区管理员会话", () => {
  beforeEach(() => clearCommunityAdminToken());

  it("只在当前进程内存中保存并可显式退出", () => {
    expect(isCommunityAdmin()).toBe(false);
    setCommunityAdminToken("temporary-admin-token");
    expect(isCommunityAdmin()).toBe(true);
    expect(getCommunityAdminToken()).toBe("temporary-admin-token");
    expect(localStorage.getItem("temporary-admin-token")).toBeNull();
    clearCommunityAdminToken();
    expect(getCommunityAdminToken()).toBeNull();
  });
});
