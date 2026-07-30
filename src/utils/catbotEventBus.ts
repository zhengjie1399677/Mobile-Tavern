import type { IKernel } from "@/src/application/serviceContracts";
import { getRuntimeKernel } from "../kernel/runtimeKernel";

export type CatbotEvent = "api_error" | "character_imported" | "night_mode" | "idle_timeout" | "lorebook_imported" | "character_created";

type CatbotListener = (event: CatbotEvent) => void;

class CatbotEventBus {
  private kernel: IKernel;
  constructor(kernel?: IKernel) {
    const resolved = kernel ?? getRuntimeKernel();
    if (!resolved) throw new Error("CATBOT_EVENT_BUS_KERNEL_REQUIRED");
    this.kernel = resolved;
  }

  subscribe(listener: CatbotListener) {
    return this.kernel.subscribe("catbot:event", (message) => {
      try {
        // P2 待重构：IMessage 应泛型化为 IMessage<TPayload>
        listener(message.payload as CatbotEvent);
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

let defaultBus: CatbotEventBus | null = null;
function getDefaultBus(): CatbotEventBus {
  if (!defaultBus) defaultBus = new CatbotEventBus();
  return defaultBus;
}

export const catbotEventBus = {
  subscribe(listener: CatbotListener) {
    return getDefaultBus().subscribe(listener);
  },
  emit(event: CatbotEvent) {
    return getDefaultBus().emit(event);
  },
};
