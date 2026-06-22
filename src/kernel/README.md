# 🧭 微内核与 Pipeline 管道接口开发文档 (Developer Guide)

本指南旨在为开发人员详细解析系统**微内核基座**及**洋葱模型管道机制**的物理结构、接口契约与插件化开发范式。

---

## 📂 物理位置与目录结构 (Physical Directory Structure)

微内核与管道的所有核心代码均位于项目的主内核文件夹中：
👉 **[src/kernel/](file:///e:/modules/projects/Mobile-Tavern/src/kernel/)**

内部目录及文件职能分布如下：
```text
src/kernel/
├── index.ts                      # 统一对外导出入口与内核冷启动装配函数 (initializeKernel)
├── Kernel.ts                     # 核心 Kernel 容器类实现 (包含 globalKernel 单例)
├── types.ts                      # 全局微内核契约接口规范 (IKernel, IKernelService, IPipeline 等)
└── services/                     # 下沉的官方核心微服务实现
    ├── DatabaseService.ts        # 数据库物理 CRUD 服务 [isCritical: 致命]
    ├── LLMService.ts             # 大模型数据通信与 SSE 流式读取服务
    ├── PromptService.ts          # Prompt 组装与宏替换服务
    ├── TelemetryService.ts       # APM 使用率上报与崩溃日志本地落盘遥测服务
    ├── TableMemoryService.ts     # TRPG 表格数据游戏化记忆切面服务
    ├── ScriptService.ts          # 角色卡扩展字段变量沙盒 MVU 服务
    └── AutoSummaryService.ts     # 会话未总结轮数计算与故事大纲自动提炼服务
```

---

## 🛡️ 架构核心优化准则 (Architectural Hardening Standards)

为了应对未来 50+ 插件并发以及双用户高频实时数据渲染，基座契约遵循以下铁律设计：
1.  **消息总线订阅注销机制**：订阅消息处理器 `subscribe` 必须返回一个 `dispose` 函数（或通过 `unsubscribe`），确保插件卸载或服务销毁时事件处理器能够被干净地从总线订阅路由表中移除，防范事件重叠触发和内存泄漏。
2.  **原子化注册 (Atomic Register)**：必须先 `await service.init(kernel)` 初始化成功后，再将服务实例写入 `services` 容器。严禁在服务还未完全就绪时泄露实例，避免并发状态下其他服务调用未就绪实例引发故障。
3.  **活跃任务异步取消与 Abort 熔断**：
    - 服务及消息订阅处理器在执行超时（如 `initTimeoutMs` 或 `MSG_TIMEOUT_MS`）或抛出异常时，内核会触发 `AbortController.abort()` 中止底层的异步任务，杜绝僵尸任务后台运行修改内核状态。
    - 内核暴露 `destroy()` 方法，在注销时强制 abort 所有当前处于挂起状态 of 活跃控制器（`activeControllers`），从物理上彻底回收 WebView 进程资源。
4.  **管道自动 next() / interrupt() 强校验**：如果中间件执行完毕，但**未调用 `next()`** 且**未调用第三参数 `interrupt()`** 显式声明拦截：
    - **开发模式下**：直接抛出致命 `Error`（迫使开发者规范使用 `next()` 或 `interrupt()`，防止拦截型插件的越界逻辑被静默跳过或绕过）。
    - **生产模式下**：终止管道并打出错误日志，绝不自动穿透安全边界。
5.  **SafeProxy 开发期断言拦截**：当请求的服务未注册或启动崩溃时，Safe Proxy 在生产环境静默提供降级空操作；但在开发模式下，任何对该空 Proxy 属性的访问将直接抛出致命 `Error`，杜绝功能失效黑洞。
6.  **依赖与消息主题强常量化**：统一使用 `KernelServices` 常量枚举以保证命名统一和防拼写错误。

---

## 🛠️ 接口契约详细规范 (API Specifications)

### 1. 微服务与消息主体契约

```typescript
export const KernelServices = {
  Database: "database",
  LLM: "llm",
  Prompt: "prompt",
  Telemetry: "telemetry",
  TableMemory: "tableMemory",
  Script: "script",
  AutoSummary: "autoSummary",
} as const;

export interface IMessage {
  topic: string;
  payload: any;
  metadata?: Record<string, any>;
}
```

### 2. 微内核核心容器接口 `IKernel`

```typescript
export interface IKernel {
  // 服务管理 API
  registerService(name: string, service: IKernelService, initTimeoutMs?: number): Promise<void>;
  registerServiceBatch(entries: Array<{ name: string; service: IKernelService; initTimeoutMs?: number }>): Promise<void>;
  getService<T extends IKernelService>(name: string): T;
  destroyService(name: string): Promise<void>;

  // 管道 (Pipeline) 管理 API
  registerPipeline<T = any>(name: string): IPipeline<T>;
  getPipeline<T = any>(name: string): IPipeline<T>;
  
  // 消息总线 (MessageBus) 订阅分发 API
  subscribe(topic: string, handler: (message: IMessage, signal?: AbortSignal) => void | Promise<void>, priority?: number): () => void;
  unsubscribe(topic: string, handler: (message: IMessage, signal?: AbortSignal) => void | Promise<void>): void;
  publish(message: IMessage): Promise<void>;
  publishParallel(message: IMessage): Promise<void>;

  // 容器销毁 API
  destroy(): Promise<void>;
}
```

### 3. 洋葱模型管道与服务接口

```typescript
export type InterruptFn = () => void;

export type Middleware<T> = (
  context: T, 
  next: () => Promise<void>, 
  interrupt: InterruptFn
) => Promise<void> | void;

export interface IPipeline<T> {
  // 注册中间件，返回注销闭包函数
  use(middleware: Middleware<T>, priority?: number): () => void;
  // 显式卸载中间件
  unuse(middleware: Middleware<T>): void;
  // 触发管道串行执行
  execute(context: T): Promise<void>;
  // 列出当前所有中间件的快照（用于可观测性调试）
  list(): ReadonlyArray<{ name: string; priority: number }>;
}

export interface IKernelService {
  name: string;
  isCritical?: boolean;
  dependencies?: readonly string[];
  init(kernel: IKernel, signal?: AbortSignal): Promise<void> | void;
  destroy?(kernel: IKernel, signal?: AbortSignal): Promise<void> | void;
}
```

---

## 💻 核心开发范式与代码示例 (Developer Cookbook)

### 示例一：开发并订阅消息服务 (Developing a Custom subscriber Service)

```typescript
import { IKernel, IKernelService, IMessage } from "../types";

export class CustomFeatureService implements IKernelService {
  name = "custom-feature-service";
  isCritical = false;
  // 声明该服务所依赖的前序服务名
  dependencies = ["database", "llm"] as const;

  private messageDispose?: () => void;

  async init(kernel: IKernel, signal?: AbortSignal): Promise<void> {
    console.log("Custom Service Initializing...");
    
    if (signal) {
      signal.addEventListener("abort", () => {
        console.warn("Service initialization was aborted.");
      });
    }

    // 订阅特定的消息主题并保存注销函数
    this.messageDispose = kernel.subscribe(
      "chat:message_received", 
      this.onMessageReceived
    );
  }

  async destroy(kernel: IKernel, signal?: AbortSignal): Promise<void> {
    // 销毁时注销消息总线订阅，防内存泄漏
    if (this.messageDispose) {
      this.messageDispose();
    }
    console.log("Custom Service Destroyed.");
  }

  private onMessageReceived = async (message: IMessage, signal?: AbortSignal) => {
    // 可选参数 signal 由 publish/publishParallel 传入，可在订阅处理超时或内核被销毁后中止内部异步 I/O
    console.log("Received a message through MessageBus:", message.payload);
  };
}
```

---

### 示例二：挂载中间件对大模型输入流进行安全过滤与拦截 (Pipeline Interception)

```typescript
import { globalKernel } from "./src/kernel/Kernel";

// 1. 注册一个敏感词拦截中间件
const unsubscribeWordFilter = globalKernel.getPipeline("input").use(async (ctx, next, interrupt) => {
  if (ctx.userInput.includes("敏感词")) {
    // 调用第三个参数 interrupt() 显式声明受控阻断，不再执行后续中间件并拦截
    interrupt();
    ctx.userInput = "[被合规过滤]";
    return;
  }
  // 放行
  await next();
}, 100);

// 2. 正常运行完毕后，如需注销直接执行：
// unsubscribeWordFilter();
```
