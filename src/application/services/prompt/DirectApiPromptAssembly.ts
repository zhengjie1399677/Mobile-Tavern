import type { ChatSession } from "../../../types";
import type { PromptAssemblyResult } from "./PromptAssemblyResult";

/** 严格直连只转发真实对话，不经过任何角色、记忆或请求整形编排。 */
export function buildDirectApiPromptAssembly(
  chat: Pick<ChatSession, "messages">,
  userInput: string,
): PromptAssemblyResult {
  const messages = chat.messages.flatMap((message) => {
    if (message.sender !== "user" && message.sender !== "assistant") return [];
    return [{ role: message.sender, content: message.content }];
  });
  return {
    systemInstruction: "",
    dynamicInstruction: "",
    history: messages,
    userInput,
    messages,
  };
}
