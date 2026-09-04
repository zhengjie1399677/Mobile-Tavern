import type { Request, Response } from "express";
import type { IKernel } from "../../src/application/serviceContracts";
import { KernelServices } from "../../src/application/serviceContracts";
import type { ICharacterService, IDatabaseService, IChatStreamService, ISettingsService } from "../../src/application/serviceContracts";
import type { CharacterCard, ChatSession, Message, UserSettings } from "../../src/types";
import { Logger } from "../../src/utils/logger";
import { resolveApiCredentials } from "../../src/utils/resolveApiCredentials";

const logger = Logger.create("OpenAiAdapter");

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "developer";
  content: string | Array<{ type: string; text?: string }>;
}

interface OpenAiChatCompletionRequest {
  model?: string;
  messages?: OpenAiMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
}

/** 提取消息中的纯文本内容。 */
function extractTextContent(content: OpenAiMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n");
  }
  return "";
}

/** GET /v1/models: 返回可用模型（映射已有角色卡与通用底座）。 */
export async function handleListModels(kernel: IKernel, req: Request, res: Response): Promise<void> {
  try {
    const characterService = kernel.getService<ICharacterService<CharacterCard>>(KernelServices.Character);
    const characters = await characterService.getAllCharacters();

    const modelsData = [
      {
        id: "mobile-tavern-default",
        object: "model",
        created: 1677610602,
        owned_by: "mobile-tavern",
      },
      ...characters.map((char) => ({
        id: char.name || char.id,
        object: "model",
        created: 1677610602,
        owned_by: "mobile-tavern-character",
      })),
    ];

    res.json({
      object: "list",
      data: modelsData,
    });
  } catch (err) {
    logger.error("Failed to list models", err);
    res.status(500).json({
      error: {
        message: "Failed to list models",
        type: "server_error",
        code: 500,
      },
    });
  }
}

/** POST /v1/chat/completions: OpenAI 兼容对话补全。 */
export async function handleChatCompletions(
  kernel: IKernel,
  req: Request,
  res: Response,
): Promise<void> {
  const controller = new AbortController();
  req.on("close", () => {
    controller.abort();
  });

  try {
    const body = (req.body || {}) as OpenAiChatCompletionRequest;
    const isStream = body.stream === true;
    const requestedModel = (body.model || "mobile-tavern-default").trim();
    const rawMessages = body.messages || [];

    if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
      res.status(400).json({
        error: {
          message: "Missing or empty 'messages' array in request body",
          type: "invalid_request_error",
          code: 400,
        },
      });
      return;
    }

    // 1. 获取角色与设置
    const characterService = kernel.getService<ICharacterService<CharacterCard>>(KernelServices.Character);
    const settingsService = kernel.getService<ISettingsService<UserSettings>>(KernelServices.Settings);
    const chatStreamService = kernel.getService<IChatStreamService>(KernelServices.ChatStream);
    const characters = await characterService.getAllCharacters();

    // 尝试根据 requestedModel 匹配已有角色卡
    const matchedCharacter = characters.find(
      (c) =>
        c.id === requestedModel ||
        c.name.toLowerCase() === requestedModel.toLowerCase(),
    ) || characters[0];

    // 2. 提取系统提示词和对话上下文
    const systemPromptParts: string[] = [];
    if (matchedCharacter) {
      if (matchedCharacter.system_prompt) systemPromptParts.push(matchedCharacter.system_prompt);
      if (matchedCharacter.description) systemPromptParts.push(`Character description: ${matchedCharacter.description}`);
      if (matchedCharacter.personality) systemPromptParts.push(`Personality: ${matchedCharacter.personality}`);
      if (matchedCharacter.scenario) systemPromptParts.push(`Scenario: ${matchedCharacter.scenario}`);
    }

    // 汇总来自请求中的 system / developer 消息
    for (const msg of rawMessages) {
      if (msg.role === "system" || msg.role === "developer") {
        const text = extractTextContent(msg.content);
        if (text) systemPromptParts.push(text);
      }
    }

    // 提取非 system 消息
    const chatMessages = rawMessages
      .filter((msg) => msg.role === "user" || msg.role === "assistant")
      .map((msg) => ({
        role: msg.role,
        content: extractTextContent(msg.content),
      }));

    const userSettings = (await settingsService.getStoredSettings()) || ({} as UserSettings);
    const { baseUrl, apiKey } = resolveApiCredentials(userSettings);

    const actualModel = userSettings.api?.modelName || "gpt-4o";

    const assembledMessages = [
      ...(systemPromptParts.length > 0
        ? [{ role: "system", content: systemPromptParts.join("\n\n") }]
        : []),
      ...chatMessages,
    ];

    const streamReqBody = {
      model: actualModel,
      messages: assembledMessages,
      stream: true,
      temperature: body.temperature ?? userSettings.preset?.temperature ?? 0.8,
      max_tokens: body.max_tokens ?? userSettings.preset?.maxTokens ?? 2048,
      top_p: body.top_p ?? userSettings.preset?.topP ?? 1.0,
    };

    const completionId = `chatcmpl-${Date.now()}`;
    const createdTimestamp = Math.floor(Date.now() / 1000);

    if (isStream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      try {
        const stream = chatStreamService.streamLlmResponse({
          baseUrl,
          apiKey,
          reqBody: streamReqBody,
          signal: controller.signal,
        });

        for await (const chunk of stream) {
          if (controller.signal.aborted || res.destroyed) break;

          const textContent =
            chunk.content || chunk.choices?.[0]?.delta?.content || "";
          if (textContent) {
            const chunkPayload = {
              id: completionId,
              object: "chat.completion.chunk",
              created: createdTimestamp,
              model: requestedModel,
              choices: [
                {
                  index: 0,
                  delta: { content: textContent },
                  finish_reason: null,
                },
              ],
            };
            res.write(`data: ${JSON.stringify(chunkPayload)}\n\n`);
          }
        }

        if (!res.destroyed && !controller.signal.aborted) {
          const finishPayload = {
            id: completionId,
            object: "chat.completion.chunk",
            created: createdTimestamp,
            model: requestedModel,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: "stop",
              },
            ],
          };
          res.write(`data: ${JSON.stringify(finishPayload)}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
        }
      } catch (streamErr: unknown) {
        if (!res.headersSent) {
          res.status(500).json({
            error: {
              message: streamErr instanceof Error ? streamErr.message : String(streamErr),
              type: "stream_error",
            },
          });
        } else {
          res.write(`data: {"error": "Stream interrupted"}\n\n`);
          res.end();
        }
      }
      return;
    }

    // 非流式：收集完整回复后统一返回
    let accumulatedText = "";
    const stream = chatStreamService.streamLlmResponse({
      baseUrl,
      apiKey,
      reqBody: streamReqBody,
      signal: controller.signal,
    });

    for await (const chunk of stream) {
      if (controller.signal.aborted) break;
      accumulatedText +=
        chunk.content || chunk.choices?.[0]?.delta?.content || "";
    }

    res.json({
      id: completionId,
      object: "chat.completion",
      created: createdTimestamp,
      model: requestedModel,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: accumulatedText,
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: accumulatedText.length,
        total_tokens: accumulatedText.length,
      },
    });
  } catch (err: unknown) {
    logger.error("Chat completion error", err);
    if (!res.headersSent) {
      res.status(500).json({
        error: {
          message: err instanceof Error ? err.message : String(err),
          type: "server_error",
          code: 500,
        },
      });
    }
  }
}
