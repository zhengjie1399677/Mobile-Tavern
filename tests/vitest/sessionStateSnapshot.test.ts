import { describe, expect, it } from "vitest";
import {
  attachSessionStateSnapshot,
  findLegacyMvuVariables,
  findSessionStateSnapshot,
  readSessionStateSnapshot,
} from "../../src/domain/chat/sessionStateSnapshot";
import type { Message, TableMemorySheet } from "../../src/types";

const message: Message = {
  id: "assistant-1",
  sender: "assistant",
  content: "回复",
  timestamp: 1,
  extra: { preserved: true },
};

const tableMemory: TableMemorySheet[] = [{
  id: "sheet-1",
  name: "状态",
  columns: ["名称", "值"],
  rows: [["好感", "7"]],
  enable: true,
}];

describe("会话状态快照", () => {
  it("助手消息保存完整变量与状态表，读取结果与源对象相互隔离", () => {
    const variables = { affection: 7, nested: { stage: "friend" } };
    const attached = attachSessionStateSnapshot(message, { variables, tableMemory });
    variables.nested.stage = "changed";
    tableMemory[0].rows[0][1] = "99";

    const snapshot = readSessionStateSnapshot(attached);
    expect(attached.extra?.preserved).toBe(true);
    expect(snapshot).toEqual({
      version: 1,
      variables: { affection: 7, nested: { stage: "friend" } },
      tableMemory: [{
        id: "sheet-1",
        name: "状态",
        columns: ["名称", "值"],
        rows: [["好感", "7"]],
        enable: true,
      }],
    });

    if (snapshot?.variables) snapshot.variables.affection = 100;
    expect(readSessionStateSnapshot(attached)?.variables?.affection).toBe(7);
  });

  it("从后向前选择最近快照，并兼容旧 MVU swipe 变量", () => {
    const older = attachSessionStateSnapshot(message, { variables: { stage: 1 } });
    const newer = attachSessionStateSnapshot({ ...message, id: "assistant-2" }, { variables: { stage: 2 } });
    expect(findSessionStateSnapshot([older, newer])?.variables).toEqual({ stage: 2 });

    const legacy: Message = {
      ...message,
      id: "legacy",
      swipe_id: 1,
      extra: { variables: { "0": { stage: 1 }, "1": { stage: 2 } } },
    };
    expect(findLegacyMvuVariables([legacy])).toEqual({ stage: 2 });
  });

  it("拒绝损坏或类型不匹配的外部快照", () => {
    expect(readSessionStateSnapshot({
      ...message,
      extra: { mobileTavernSessionState: { version: 1, variables: [] } },
    })).toBeUndefined();
    expect(readSessionStateSnapshot({
      ...message,
      extra: {
        mobileTavernSessionState: {
          version: 1,
          tableMemory: [{ id: "broken", name: "损坏", columns: [], rows: "not-array", enable: true }],
        },
      },
    })).toBeUndefined();
  });
});
