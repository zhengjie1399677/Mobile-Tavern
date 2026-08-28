export const BUILTIN_DIRECT_API_CHARACTER_ID = "base-agent-builtin";

interface DirectApiCharacterLike {
  readonly id: string;
  readonly agentMode?: string;
}

/** ID 兼容早期已落库的内置通用助手；新数据以显式 agentMode 为准。 */
export function isDirectApiCharacter(character: DirectApiCharacterLike): boolean {
  return character.agentMode === "direct-api"
    || character.id === BUILTIN_DIRECT_API_CHARACTER_ID;
}
