import { z } from "zod";
import type { AgentToolDefinition } from "../../domain/agents/contracts";
import type {
  ICharacterService,
  IDatabaseService,
} from "../serviceContracts";
import type {
  CharacterCard,
  ChatSession,
  ChatSessionMetadataPatch,
  Message,
  SummaryCard,
} from "../../types";

export const CHARACTER_READ_TOOL_NAME = "character.read";
export const SESSION_BRANCH_TOOL_NAME = "session.branch";

type MobileTavernDatabaseService = IDatabaseService<
  ChatSession,
  CharacterCard,
  SummaryCard,
  Message,
  ChatSessionMetadataPatch
>;

const characterReadInputSchema = z.object({}).strict();
const characterReadOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  personality: z.string(),
  scenario: z.string(),
  creator: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const sessionBranchInputSchema = z.object({
  title: z.string().trim().min(1).max(80),
}).strict();
const sessionBranchOutputSchema = z.object({
  sessionId: z.string(),
  title: z.string(),
  sourceSessionId: z.string(),
  createdAt: z.number(),
});

/** 读取当前会话角色的公开描述字段；头像字节、扩展与变量不会进入模型。 */
export function createCharacterReadTool(
  database: Pick<MobileTavernDatabaseService, "getSessionById">,
  characters: Pick<ICharacterService<CharacterCard>, "getCharacterById">,
): AgentToolDefinition {
  return {
    name: CHARACTER_READ_TOOL_NAME,
    version: "1.0.0",
    description: "读取当前会话角色的名称、简介、性格、场景、作者与标签，不返回头像、扩展或私有变量。",
    inputSchema: characterReadInputSchema,
    inputJsonSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    outputSchema: characterReadOutputSchema,
    permissions: ["character.read"],
    riskLevel: "low",
    sideEffect: "none",
    executionScope: "session",
    policy: "allow",
    timeoutMs: 10_000,
    async execute(_input, context) {
      throwIfAborted(context.signal);
      const session = await database.getSessionById(context.sessionId);
      throwIfAborted(context.signal);
      if (!session) throw new Error("CHARACTER_READ_SESSION_NOT_FOUND");
      const character = await characters.getCharacterById(session.characterId);
      throwIfAborted(context.signal);
      if (!character) throw new Error("CHARACTER_READ_CHARACTER_NOT_FOUND");
      return {
        id: character.id,
        name: character.name,
        description: character.description,
        personality: character.personality,
        scenario: character.scenario,
        creator: character.creator,
        tags: character.tags ? [...character.tags] : undefined,
      };
    },
  };
}

/** 经一次性审批创建新的本地会话分支，并在首次写入时保存来源会话 ID。 */
export function createSessionBranchTool(
  database: Pick<
    MobileTavernDatabaseService,
    "getSessionById" | "getCharacterById" | "createEmptyBranch"
  >,
): AgentToolDefinition {
  return {
    name: SESSION_BRANCH_TOOL_NAME,
    version: "1.0.0",
    description: "创建一个新的本地会话分支，并记录当前会话为来源；执行前需要用户允许一次。",
    inputSchema: sessionBranchInputSchema,
    inputJsonSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          minLength: 1,
          maxLength: 80,
          description: "新分支标题",
        },
      },
      required: ["title"],
      additionalProperties: false,
    },
    outputSchema: sessionBranchOutputSchema,
    permissions: ["session.write"],
    riskLevel: "medium",
    sideEffect: "local-write",
    executionScope: "session",
    policy: "ask",
    timeoutMs: 30_000,
    approvalTimeoutMs: 60_000,
    async execute(input, context) {
      throwIfAborted(context.signal);
      const parsed = sessionBranchInputSchema.parse(input);
      const source = await database.getSessionById(context.sessionId);
      throwIfAborted(context.signal);
      if (!source) throw new Error("SESSION_BRANCH_SOURCE_NOT_FOUND");
      const character = await database.getCharacterById(source.characterId);
      throwIfAborted(context.signal);
      if (!character) throw new Error("SESSION_BRANCH_CHARACTER_NOT_FOUND");
      const branch = await database.createEmptyBranch(
        character,
        parsed.title,
        source.id,
        context.signal,
      );
      throwIfAborted(context.signal);
      return {
        sessionId: branch.id,
        title: branch.title,
        sourceSessionId: source.id,
        createdAt: branch.createdAt,
      };
    },
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}
