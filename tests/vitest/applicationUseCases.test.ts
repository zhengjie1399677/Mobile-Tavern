import { describe, expect, it, vi } from "vitest";
import {
  createCharacterUseCases,
  normalizeCharacterCard,
} from "../../src/application/useCases/characterUseCases";
import {
  canActivateChatSession,
  createChatSessionUseCases,
  mergeSessionPage,
} from "../../src/application/useCases/chatSessionUseCases";
import { loadActiveSessionsForCharacter } from "../../src/application/useCases/sessionDirectoryUseCases";
import type {
  ICharacterService,
  IDatabaseService,
  ISessionManagementService,
} from "../../src/application/serviceContracts";
import type { SessionDirectorySnapshot } from "../../src/domain/session-management";
import type {
  CharacterCard,
  ChatSession,
  ChatSessionMetadataPatch,
  Message,
  SummaryCard,
} from "../../src/types";

const character = {
  id: "char-1",
  name: "角色",
  lorebookEntries: [],
} as unknown as CharacterCard;

const session = {
  id: "session-1",
  characterId: character.id,
  messages: [],
  summaries: [],
  createdAt: 1,
} as unknown as ChatSession;

describe("application useCases 边界回归", () => {
  it("角色目录初始化流程由用例层协调，Context 无需直接编排存储", async () => {
    const service = {
      getCharacterCatalog: vi.fn().mockResolvedValue([character]),
      getStoredDefaultCharactersInitializedFlag: vi.fn().mockResolvedValue(true),
    } as unknown as ICharacterService<CharacterCard>;

    const result = await createCharacterUseCases(service).loadCatalog();

    expect(result).toEqual([character]);
    expect(service.getCharacterCatalog).toHaveBeenCalledOnce();
  });

  it("兼容输入中的字符串世界书关键词在用例边界完成归一化", () => {
    const externalCharacter = {
      ...character,
      lorebookEntries: [{ id: "entry-1", keys: "alpha, beta" }],
    } as unknown as CharacterCard;

    expect(normalizeCharacterCard(externalCharacter).lorebookEntries?.[0].keys)
      .toEqual(["alpha", "beta"]);
  });

  it("会话分页由用例层调用 Service，并返回界面可直接投影的结果", async () => {
    const database = {
      getSessionsCount: vi.fn().mockResolvedValue(1),
      getSessionCountsByCharacter: vi.fn().mockResolvedValue({ [character.id]: 1 }),
      getSessionsPage: vi.fn().mockResolvedValue({ sessions: [session], hasMore: false }),
    } as unknown as IDatabaseService<ChatSession, CharacterCard, SummaryCard, Message, ChatSessionMetadataPatch>;
    const result = await createChatSessionUseCases(database)
      .loadInitialSessions(50);

    expect(result).toEqual({
      sessions: [session],
      total: 1,
      countsByCharacter: { [character.id]: 1 },
      hasMore: false,
    });
  });

  it("分页合并去重且保持已有会话顺序", () => {
    const second = { ...session, id: "session-2" };
    expect(mergeSessionPage([session], [session, second]).map((item) => item.id))
      .toEqual(["session-1", "session-2"]);
  });

  it("激活分页外会话前通过用例层读取完整会话元数据", async () => {
    const database = {
      getSessionById: vi.fn(async (id: string) => id === session.id ? session : null),
    } as unknown as IDatabaseService<ChatSession, CharacterCard, SummaryCard, Message, ChatSessionMetadataPatch>;
    const useCases = createChatSessionUseCases(database);

    await expect(useCases.loadSessionForActivation(session.id)).resolves.toEqual(session);
    await expect(useCases.loadSessionForActivation("missing")).resolves.toBeNull();
  });

  it("归档会话不能进入普通聊天激活流程", () => {
    expect(canActivateChatSession(session)).toBe(true);
    expect(canActivateChatSession({ ...session, lifecycle: "archived" })).toBe(false);
  });

  it("角色会话目录通过稳定游标加载完整分页，并可限制最近条数", async () => {
    const second = { ...session, id: "session-2", updatedAt: 2 };
    const cursor = { category: "active", sort: "updated_desc", value: 2, createdAt: 1, id: second.id } as const;
    const emptySnapshot = (): SessionDirectorySnapshot => ({
      active: [], favorites: [], archived: [],
      pageInfo: {
        active: { hasMore: false },
        favorite: { hasMore: false },
        archived: { hasMore: false },
      },
      characters: [],
    });
    const first = emptySnapshot();
    first.active = [{ session: second, characterName: character.name, branchCount: 0 }];
    first.pageInfo.active = { hasMore: true, cursor };
    const last = emptySnapshot();
    last.active = [{ session, characterName: character.name, branchCount: 0 }];
    const service = {
      queryDirectory: vi.fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(last),
    } as unknown as ISessionManagementService<ChatSession>;

    await expect(loadActiveSessionsForCharacter(service, character.id)).resolves.toEqual([second, session]);
    expect(service.queryDirectory).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor }));

    service.queryDirectory = vi.fn().mockResolvedValue(first);
    await expect(loadActiveSessionsForCharacter(service, character.id, 1)).resolves.toEqual([second]);
    expect(service.queryDirectory).toHaveBeenCalledOnce();
  });
});
