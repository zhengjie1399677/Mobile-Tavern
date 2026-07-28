import type { CharacterCard, ChatSession } from "../../types";
import type { PluginPermission } from "./types";

const MAX_PLUGIN_TEXT_LENGTH = 4_000;

export interface PluginHostContext {
  activeCharacter: CharacterCard | null;
  activeSession: ChatSession | null;
}

export interface PluginHostActions {
  injectAction(text: string): Promise<void>;
  sendMessage(text: string): Promise<void>;
}

/** Bridge V2 的纯领域分发器：权限、输入清洗和上下文脱敏均在宿主边界完成。 */
export async function dispatchPluginHostRequest(
  permissions: readonly PluginPermission[] | undefined,
  method: string,
  params: unknown,
  context: PluginHostContext,
  actions: PluginHostActions,
): Promise<unknown> {
  if (method === "context.get") {
    requirePermission(permissions, "context.read");
    return createReadonlyPluginContext(context);
  }
  if (method === "chat.injectAction") {
    requirePermission(permissions, "chat.action");
    await actions.injectAction(readText(params));
    return null;
  }
  if (method === "chat.send") {
    requirePermission(permissions, "chat.send");
    await actions.sendMessage(readText(params));
    return null;
  }
  throw new Error("PLUGIN_METHOD_NOT_ALLOWED");
}

export function createReadonlyPluginContext(context: PluginHostContext): Readonly<Record<string, unknown>> {
  const character = context.activeCharacter;
  const session = context.activeSession;
  return deepFreeze({
    character: character ? {
      id: character.id,
      name: character.name,
      description: character.description,
      personality: character.personality,
      scenario: character.scenario,
      tags: [...(character.tags ?? [])],
    } : null,
    session: session ? {
      id: session.id,
      title: session.title,
      characterId: session.characterId,
      messageCount: session.messages?.length ?? 0,
      parentSessionId: session.parentSessionId ?? null,
    } : null,
  });
}

function requirePermission(
  permissions: readonly PluginPermission[] | undefined,
  required: PluginPermission,
): void {
  if (!permissions?.includes(required)) throw new Error("PLUGIN_PERMISSION_DENIED");
}

function readText(params: unknown): string {
  const text = params && typeof params === "object"
    ? (params as Record<string, unknown>).text
    : undefined;
  if (typeof text !== "string") throw new Error("PLUGIN_CHAT_INVALID_TEXT");
  const normalized = text.trim();
  if (!normalized || normalized.length > MAX_PLUGIN_TEXT_LENGTH || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(normalized)) {
    throw new Error("PLUGIN_CHAT_INVALID_TEXT");
  }
  return normalized;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
