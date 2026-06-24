import { globalKernel } from "../kernel/Kernel";

export type CatbotEvent = "api_error" | "character_imported" | "night_mode" | "idle_timeout" | "lorebook_imported" | "character_created";

type CatbotListener = (event: CatbotEvent) => void;

class CatbotEventBus {
  subscribe(listener: CatbotListener) {
    return globalKernel.subscribe("catbot:event", (message) => {
      try {
        listener(message.payload);
      } catch (e) {
        console.error("Failed to execute Catbot listener", e);
      }
    });
  }

  emit(event: CatbotEvent) {
    globalKernel.publish({
      topic: "catbot:event",
      payload: event
    });
  }
}

export const catbotEventBus = new CatbotEventBus();
