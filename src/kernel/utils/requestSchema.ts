/**
 * 请求与响应防腐层（Anti-Corruption Layer）
 *
 * 本模块负责清洗来自外部接口（大模型 API 响应、中转代理响应、第三方角色卡导入）的输入，
 * 防止非标参数、脏数据或临时兼容逻辑渗透到核心逻辑层（useChat、数据库物理存储层）。
 *
 * 实现 AGENTS.md 准则一.3「接口防腐隔离」铁则。
 */

/**
 * OpenAI Chat Completion API 标准请求字段白名单。
 * 仅这些字段允许透传到下游 LLM API。
 */
const REQUEST_FIELD_WHITELIST = new Set<string>([
  // 核心字段
  "model",
  "messages",
  "stream",
  "stream_options",
  // 采样参数
  "temperature",
  "top_p",
  "top_k",
  "min_p",
  "max_tokens",
  "max_completion_tokens",
  "stop",
  "presence_penalty",
  "frequency_penalty",
  "repetition_penalty",
  "seed",
  // 工具调用
  "tools",
  "tool_choice",
  "functions",
  "function_call",
  // 结构化输出
  "response_format",
  "json_schema",
  // 服务端日志
  "user",
  "n",
  // 扩展字段（部分中转站支持）
  "enableReasoning",
  "reasoning_effort",
  "thinking",
  "max_thinking_tokens",
  "thinking_budget",
  // 多模态
  "modalities",
  "audio",
  // 缓存控制
  "logit_bias",
  "logprobs",
  "top_logprobs",
  // 服务端侧元数据
  "metadata",
]);

/**
 * 清洗请求体：仅保留白名单字段，剥离未知脏数据。
 *
 * 同时处理 max_completion_tokens 与 max_tokens 的互斥逻辑：
 * OpenAI 新 API 使用 max_completion_tokens，若同时存在则移除旧的 max_tokens，
 * 避免部分严格 API 同时收到两者报 400 错误。
 *
 * @param baseUrl  目标 baseUrl（保留参数以便未来按 baseUrl 应用不同策略）
 * @param reqBody  原始请求体
 */
export function cleanRequestPayload(
  baseUrl: string | undefined,
  reqBody: Record<string, any> | undefined
): Record<string, any> | undefined {
  if (!reqBody) return reqBody;

  const cleaned: Record<string, any> = {};
  for (const key of Object.keys(reqBody)) {
    if (REQUEST_FIELD_WHITELIST.has(key)) {
      cleaned[key] = reqBody[key];
    }
  }

  // max_completion_tokens 与 max_tokens 互斥
  if (cleaned.max_completion_tokens !== undefined) {
    delete cleaned.max_tokens;
  }

  // 防御：剥离可能的原型污染键名
  const dangerousKeys: readonly string[] = ["__proto__", "constructor", "prototype"];
  for (const key of dangerousKeys) {
    delete cleaned[key];
  }

  return cleaned;
}

/**
 * OpenAI Chat Completion API 标准响应字段白名单（顶层）。
 */
const RESPONSE_TOP_LEVEL_WHITELIST = new Set<string>([
  "id",
  "object",
  "model",
  "choices",
  "usage",
  "system_fingerprint",
  "created",
]);

/**
 * choices[].message 标准字段白名单。
 */
const RESPONSE_MESSAGE_WHITELIST = new Set<string>([
  "role",
  "content",
  "reasoning_content",
  "tool_calls",
  "function_call",
  "refusal",
]);

/**
 * 清洗 LLM 响应：仅保留标准字段，剥离中转站注入的非标字段。
 *
 * 用于 `/api/proxy/openai` 端点返回前的最后清洗，防止第三方中转站
 * 注入 extra_data / debug_info / prompt_hash 等非标字段渗透到 sessions 表与消息渲染管线。
 *
 * 注意：本函数仅清洗非流式响应（type === "openai-compat" 的非流式分支）。
 * 流式响应由 streamReader 逐 chunk 处理，仅提取 choices[].delta.content / reasoning_content。
 */
type CleanLLMResponseReturn<T> = T extends null | undefined ? T : Record<string, any>;

export function cleanLLMResponse<T extends Record<string, any> | null | undefined>(
  resp: T
): CleanLLMResponseReturn<T> {
  if (!resp) return resp as CleanLLMResponseReturn<T>;

  const cleaned: Record<string, any> = {};
  for (const key of Object.keys(resp)) {
    if (RESPONSE_TOP_LEVEL_WHITELIST.has(key)) {
      cleaned[key] = resp[key];
    }
  }

  // 清洗 choices[].message
  if (Array.isArray(cleaned.choices)) {
    cleaned.choices = cleaned.choices.map((choice: any) => {
      if (!choice || typeof choice !== "object") return choice;
      const cleanedChoice: Record<string, any> = {};
      for (const key of Object.keys(choice)) {
        if (key === "message" || key === "delta") {
          const msg = choice[key];
          if (msg && typeof msg === "object") {
            const cleanedMsg: Record<string, any> = {};
            for (const msgKey of Object.keys(msg)) {
              if (RESPONSE_MESSAGE_WHITELIST.has(msgKey)) {
                cleanedMsg[msgKey] = msg[msgKey];
              }
            }
            cleanedChoice[key] = cleanedMsg;
          } else {
            cleanedChoice[key] = msg;
          }
        } else if (key === "index" || key === "finish_reason" || key === "logprobs") {
          cleanedChoice[key] = choice[key];
        }
      }
      return cleanedChoice;
    });
  }

  return cleaned as CleanLLMResponseReturn<T>;
}
