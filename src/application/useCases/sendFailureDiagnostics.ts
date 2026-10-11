/**
 * 发送失败的提示文案。
 *
 * 按错误来源分流：`MULTIMODAL_*` 是**客户端投影**错误（本地配置/格式问题），
 * 不能拿去怪服务端；只有真正的传输/接口错误才提示模型能力。
 */

const CLIENT_PROJECTION_PREFIX = "MULTIMODAL_";

function describeProjectionFailure(code: string): string {
  if (code.startsWith("MULTIMODAL_AUDIO_ATTACHMENT_REQUIRES_TRANSCRIPT")) {
    return "这条音频附件还没有转写文本。请在 设置 → 语音 中启用 OpenAI ASR 文件转写后重试，或改用文字输入。";
  }
  if (
    code.startsWith("MULTIMODAL_AUDIO_FORMAT_UNSUPPORTED")
    || code.startsWith("MULTIMODAL_PROVIDER_MIME_UNSUPPORTED")
  ) {
    return "该音频格式无法作为模型语音输入发送（仅支持 wav / mp3）。可启用 OpenAI ASR 文件转写改为文字，或改用 wav / mp3 音频。";
  }
  if (code.startsWith("MULTIMODAL_PROVIDER_MODALITY_UNSUPPORTED")) {
    return "当前 Provider 未声明该输入能力，请切换 Provider 或配置媒体降级。";
  }
  if (code.startsWith("MULTIMODAL_PROVIDER_ATTACHMENT_TOO_LARGE")) {
    return "附件超出当前 Provider 的体积上限，请压缩或减少附件。";
  }
  if (code.startsWith("MULTIMODAL_PROVIDER_ATTACHMENT_COUNT_EXCEEDED")) {
    return "附件数量超出当前 Provider 的上限，请减少附件。";
  }
  return "该消息的媒体载荷无法转换为当前 Provider 的格式，请检查附件与 Provider 配置。";
}

/** 服务端反馈可能涉及音频载荷时的建议（不点名具体模型，避免误导）。 */
const SERVER_AUDIO_HINT =
  "诊断建议：服务端反馈不支持音频载荷。当前模型可能未开启音频多模态输入支持，或中转节点未开放 audio 通道；建议改用文本输入，或更换支持音频输入的模型。";

export function buildSendFailureAlert(rawMessage: string): string {
  const base = `发送失败，对话连接异常: ${rawMessage}`;
  if (rawMessage.startsWith(CLIENT_PROJECTION_PREFIX)) {
    return `${base}\n\n💡 ${describeProjectionFailure(rawMessage)}`;
  }
  const lower = rawMessage.toLowerCase();
  if (
    lower.includes("audio")
    || lower.includes("modality")
    || lower.includes("input_audio")
    || lower.includes("content_type")
  ) {
    return `${base}\n\n💡 ${SERVER_AUDIO_HINT}`;
  }
  return base;
}
