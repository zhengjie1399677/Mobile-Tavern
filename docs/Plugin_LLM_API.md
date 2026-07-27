# Mobile Tavern 插件 LLM 接口规范 v1

本文件定义了第三方全屏插件（运行在隔离全屏 `iframe` 中）与宿主进行 LLM（大语言模型）交互的具体接口、配置选项以及错误处理规范。

相关参考源码与文档：
* 插件系统基础规范：[Plugin_System_v1.md](file:///d:/projects/Mobile-Tavern/docs/Plugin_System_v1.md)
* 宿主注入的 API 桥接定义：[runtimeDocument.ts](file:///d:/projects/Mobile-Tavern/src/domain/plugins/runtimeDocument.ts#L219)
* 宿主请求处理器实现：[FullscreenPluginRunner.tsx](file:///d:/projects/Mobile-Tavern/src/components/plugins/FullscreenPluginRunner.tsx#L215)

---

## 1. 权限申请与配置

要使用 LLM 接口，插件必须在其 `manifest.json` 中声明对应的权限。如果未声明权限直接调用，宿主会抛出 `PLUGIN_PERMISSION_DENIED` 错误。

### 1.1 权限列表

* **`llm.chat`**：允许进行非流式的 LLM 对话。
* **`llm.chatStream`**：允许进行流式（SSE）的 LLM 对话。
* **`llm.preset.list`**：允许通过接口获取宿主当前的采样预设状态。

### 1.2 `manifest.json` 配置示例

```json
{
  "format": "mobile-tavern.plugin",
  "manifestVersion": 1,
  "id": "my.llm.game",
  "name": "LLM 交互式游戏",
  "version": "1.0.0",
  "type": "fullscreen",
  "entry": "index.html",
  "permissions": [
    "llm.chat",
    "llm.chatStream",
    "llm.preset.list"
  ],
  "llm": {
    "syncPreset": false
  }
}
```

* **`llm.syncPreset`**：控制采样参数 of 同步模式。
  * `true`：默认行为。强制使用宿主在系统设置中当前配置的采样参数（如 `temperature` 等），插件传入的自定义 `sampling` 参数将被忽略。
  * `false`：允许插件自行管理采样参数。插件通过接口参数传入的 `sampling` 自定义配置（白名单字段）将合并至 LLM 请求体。

---

## 2. API 接口定义

在运行期间，宿主会自动在全局变量 `window` 上注入并冻结命名空间：`window.MobileTavernPlugin.llm`。

接口的 TypeScript 定义如下：

```typescript
interface MobileTavernPluginLlmApi {
  /**
   * 非流式对话接口
   * @param opts 包含消息上下文及自定义采样的配置
   * @returns 包含生成文本的 Promise
   */
  chat(opts: ChatOptions): Promise<{ text: string }>;

  /**
   * 流式对话接口
   * @param opts 包含消息上下文及自定义采样的配置
   * @returns 提供链式回调注册与手动取消的控制对象
   */
  chatStream(opts: ChatOptions): StreamResult;

  /**
   * 获取宿主端参数同步配置
   * @returns 包含 syncPreset 配置布尔值的 Promise
   */
  listPresets(): Promise<{ syncPreset: boolean }>;
}
```

---

## 3. 数据类型说明

### 3.1 `ChatOptions` 参数结构

```typescript
interface ChatOptions {
  /**
   * 消息历史列表。非空数组。
   */
  messages: Array<ChatMessage>;

  /**
   * 自定义采样参数。
   * 注意：仅在 manifest.json 中配置 "syncPreset": false 时生效。
   */
  sampling?: LLMSamplingParameters;
}

interface ChatMessage {
  /**
   * 角色标识，如 "user", "assistant", "system"
   */
  role: string;

  /**
   * 消息具体文本内容
   */
  content: string;
}

interface LLMSamplingParameters {
  temperature?: number;       // 温度值，通常 0.0 - 2.0
  top_p?: number;             // 核采样阈值
  top_k?: number;             // Top K 过滤值
  min_p?: number;             // 最小概率采样阈值
  max_tokens?: number;        // 单次生成最大 token 限制
  presence_penalty?: number;  // 存在惩罚
  frequency_penalty?: number; // 频率惩罚
}
```
> [!IMPORTANT]
> 宿主会对 `sampling` 传入的属性进行严格白名单过滤，仅允许上述 7 个字段传递给大模型后端，防止注入非法字段。

### 3.2 `StreamResult` 流控制对象

流式请求通过桥接发送 `stream-request` 消息。其返回的 `StreamResult` 对象定义如下：

```typescript
interface StreamResult {
  /**
   * 注册当收到新的 Token 片段（Chunk）时的回调。
   */
  onChunk(callback: (chunkText: string) => void): StreamResult;

  /**
   * 注册生成正常结束的回调。
   * @param callback 接收包含全量文本和使用统计的对象
   */
  onDone(callback: (result: { fullText: string; usage?: any }) => void): StreamResult;

  /**
   * 注册流式交互中途报错或中断的回调。
   */
  onError(callback: (error: Error) => void): StreamResult;

  /**
   * 手动取消本次流式生成。
   * 调用此方法会发送 cancel 消息通知宿主中止请求，并清理注册的所有回调。
   */
  cancel(): void;
}
```

---

## 4. 常见错误代码

在调用 API 时可能会遇到 Promise 拒绝（Reject）或触发 `onError` 的情况，系统抛出的 Error 中的 `message` 包括：

| 错误代码 | 触发场景说明 |
| :--- | :--- |
| `PLUGIN_PERMISSION_DENIED` | 插件没有在 `manifest.json` 的 `permissions` 中声明此接口对应的权限。 |
| `PLUGIN_METHOD_NOT_ALLOWED` | 调用了未定义的非法方法。 |
| `PLUGIN_LLM_NOT_CONFIGURED` | 宿主（Mobile Tavern）系统设置中未配置有效的 LLM API 凭证或服务地址。 |
| `PLUGIN_LLM_INVALID_MESSAGES` | 传入的 `messages` 不是合法数组，或者内部的 `role`/`content` 存在非字符串或空值。 |
| `HOST_TIMEOUT` | 宿主处理请求超时（`chat` 超时时间默认为 300,000ms，`listPresets` 超时时间默认为 10,000ms）。 |
| `HOST_ERROR` | 宿主处理过程中的内部未知错误。 |

---

## 5. 完整代码调用示例

### 5.1 非流式调用示例

```javascript
async function requestExplanation() {
  const pluginLlm = window.MobileTavernPlugin?.llm;
  if (!pluginLlm) {
    console.error("宿主环境 API 未加载");
    return;
  }

  try {
    const response = await pluginLlm.chat({
      messages: [
        { role: "system", content: "你是一个专业的历史学者。" },
        { role: "user", content: "请用一句话介绍汉武帝的功过。" }
      ],
      sampling: {
        temperature: 0.7,
        max_tokens: 100
      }
    });

    console.log("生成结果为：", response.text);
  } catch (err) {
    console.error("生成失败，错误原因：", err.message);
  }
}
```

### 5.2 流式调用与中止示例

```javascript
let currentStream = null;

function requestStreamingPoem() {
  const pluginLlm = window.MobileTavernPlugin?.llm;
  if (!pluginLlm) return;

  // 避免并发流未清理
  if (currentStream) {
    currentStream.cancel();
  }

  const outputContainer = document.getElementById("output");
  outputContainer.innerText = "";
  
  let fullText = "";

  currentStream = pluginLlm.chatStream({
    messages: [
      { role: "user", content: "请写一首描述赛博朋克世界的短诗。" }
    ]
  });

  currentStream
    .onChunk((chunk) => {
      fullText += chunk;
      outputContainer.innerText = fullText;
    })
    .onDone((result) => {
      console.log("生成成功结束，总长度：", result.fullText.length);
      currentStream = null;
    })
    .onError((error) => {
      console.error("流式生成异常中断：", error.message);
      outputContainer.innerText += `\n[发生错误: ${error.message}]`;
      currentStream = null;
    });
}

// 供界面按钮绑定，支持手动取消生成
function userInterrupt() {
  if (currentStream) {
    currentStream.cancel();
    console.log("用户已手动取消大模型生成。");
    currentStream = null;
  }
}
```
