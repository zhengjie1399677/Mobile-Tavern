import { beforeEach, describe, expect, it } from "vitest";
import { getCommunityIdentity } from "../../src/domain/community/identity";

describe("community identity", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keeps one uuid while following the current user name", () => {
    const first = getCommunityIdentity(" Alice ");
    const second = getCommunityIdentity("Bob");

    expect(first.name).toBe("Alice");
    expect(second.name).toBe("Bob");
    expect(second.uuid).toBe(first.uuid);
  });

  it("uses a safe fallback for a blank user name", () => {
    expect(getCommunityIdentity("   ").name).toBe("user");
  });
});
