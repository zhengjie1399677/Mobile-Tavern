/**
 * Tauri plugin guest-js entry point for `tauri-plugin-tavern-ar`.
 *
 * Provides typed wrappers for the Kotlin @Command methods exposed by ArPlugin.
 * The frontend calls these via `invoke("plugin:TavernAr|command_name", args)`.
 */

/** ARCore availability states returned by `check_ar_availability`. */
export type ArAvailability =
  | "supported-installed"
  | "supported-not-installed"
  | "unsupported"
  | "unknown";

/** Arguments for `update_character_texture`. */
export interface UpdateTextureArgs {
  /** base64-encoded PNG (data URL or raw base64) of the current character portrait. */
  base64: string;
}

/** Arguments for `update_render_state`. */
export interface UpdateRenderStateArgs {
  /** Current emotion name (e.g. "joy", "anger", "默认"). */
  emotion: string;
  /** RGBA string for light 1 (reactive). */
  light1: string;
  /** RGBA string for light 2 (atmosphere). */
  light2: string;
}

/** Arguments for `update_chat_bubble`. */
export interface UpdateChatBubbleArgs {
  /** Text to display in the chat bubble above the character. Empty string hides the bubble. */
  text: string;
}

/** Typed API surface for the tavern-ar plugin. */
export interface TavernArApi {
  /** Check whether ARCore is available and installed on this device. */
  checkArAvailability(): Promise<ArAvailability>;
  /** Launch the full-screen AR Activity. */
  launchAr(): Promise<void>;
  /** Close the AR Activity and return to the chat. */
  closeAr(): Promise<void>;
  /** Push an updated character texture (base64 PNG) to the active AR Activity. */
  updateCharacterTexture(args: UpdateTextureArgs): Promise<void>;
  /** Push updated render state (emotion + glow colors) to the AR Activity. */
  updateRenderState(args: UpdateRenderStateArgs): Promise<void>;
  /** Push chat bubble text to the AR Activity. */
  updateChatBubble(args: UpdateChatBubbleArgs): Promise<void>;
}
