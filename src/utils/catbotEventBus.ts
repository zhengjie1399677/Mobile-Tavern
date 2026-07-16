import { globalKernel } from "../kernel/Kernel";
import type { IKernel } from "../kernel/types";

export type CatbotEvent = "api_error" | "character_imported" | "night_mode" | "idle_timeout" | "lorebook_imported" | "character_created";

type CatbotListener = (event: CatbotEvent) => void;

// TODO-2: 构造函数接收可选 kernel 参数，默认回退 globalKernel 单例。
// 如此测试环境可传入隔离的 Mock 实例，实现物理隔离测试。
class CatbotEventBus {
  private kernel: IKernel;
  constructor(kernel?: IKernel) {
    this.kernel = kernel || globalKernel;
  }

  subscribe(listener: CatbotListener) {
    return this.kernel.subscribe("catbot:event", (message) => {
      try {
        listener(message.payload);
      } catch (e) {
        console.error("Failed to execute Catbot listener", e);
      }
    });
  }

  emit(event: CatbotEvent) {
    this.kernel.publish({
      topic: "catbot:event",
      payload: event
    });
  }
}

/** 工厂函数：创建绑定到指定 kernel 的 CatbotEventBus 实例（供测试隔离使用） */
export function createCatbotEventBus(kernel?: IKernel): CatbotEventBus {
  return new CatbotEventBus(kernel);
}

export const catbotEventBus = new CatbotEventBus();
