export type CatbotEvent = "api_error" | "character_imported" | "night_mode" | "idle_timeout" | "lorebook_imported" | "character_created";

type CatbotListener = (event: CatbotEvent) => void;

class CatbotEventBus {
  private listeners: CatbotListener[] = [];

  subscribe(listener: CatbotListener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  emit(event: CatbotEvent) {
    this.listeners.forEach((l) => {
      try {
        l(event);
      } catch (e) {
        console.error("Failed to execute Catbot listener", e);
      }
    });
  }
}

export const catbotEventBus = new CatbotEventBus();
