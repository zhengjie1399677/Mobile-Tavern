/**
 * Tauri plugin guest-js entry point for `tauri-plugin-android-bridge`.
 *
 * NOTE: The Mobile Tavern frontend does NOT import this module. It keeps
 * calling the native bridge directly through
 * `(window as any).AndroidThemeBridge.*` so the existing synchronous call
 * contract (e.g. `bridge.saveFile()` returning a string path) is preserved.
 *
 * This module is shipped purely for type-safety and discoverability: it
 * declares the shape of the injected `window.AndroidThemeBridge` object so
 * that any future refactoring can opt into a typed accessor without changing
 * the native side.
 */

/** Shape of the safe-area insets returned by `getSafeAreas()`. */
export interface AndroidSafeAreas {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Typed view of the `window.AndroidThemeBridge` object injected by the
 * `AndroidBridgePlugin` Kotlin class.
 *
 * Every method is synchronous and runs on the WebView's JS thread via
 * `@JavascriptInterface`.
 */
export interface AndroidThemeBridge {
  /** Returns the current system-bar insets (in dp) as a JSON string. */
  getSafeAreas(): string;
  /** Updates the status bar background colour and icon appearance. */
  setStatusBarStyle(isDark: boolean, colorHex: string): void;
  /** Locks the Activity to sensor landscape or returns control to the system. */
  setScreenOrientation(mode: "landscape" | "auto"): boolean;
  /** Opens the Android system share sheet with text content. */
  shareText(title: string, text: string, mimeType: string): boolean;
  /**
   * Saves a UTF-8 text file to the public Download directory.
   * @returns the display path of the saved file, or an `error:`-prefixed
   *   message on failure.
   */
  saveFile(fileName: string, content: string): string;
  /**
   * Saves a binary file (base64-encoded) to the public Download directory.
   * @returns the display path of the saved file, or an `error:`-prefixed
   *   message on failure.
   */
  saveFileBase64(fileName: string, base64Data: string, mimeType: string): string;
  /** Opens a URL in the system default browser. */
  openUrl(url: string): void;
  /** Plays native Android TTS speech synthesis. */
  speakNative(text: string, rate: number, pitch: number): boolean;
  /** Stops any ongoing native Android TTS speech. */
  stopNative(): void;
  /** Checks if native Android TTS is currently speaking. */
  isSpeakingNative(): boolean;
  /** Checks if external storage read permission is granted. */
  hasStoragePermission(): boolean;
  /** Requests external storage read permission from the system. */
  requestStoragePermission(): void;
  /** Scans popular directories for .json and .png character cards, returning a JSON array string. */
  scanGlobalCards(): string;
  /** Reads the content of a local file by path (returning base64 data url for PNGs). */
  readLocalFile(path: string): string;
}

declare global {
  interface Window {
    AndroidThemeBridge?: AndroidThemeBridge;
  }
}

/**
 * Type-safe accessor for the injected bridge. Returns `null` when running
 * outside of the Android WebView (e.g. desktop dev server).
 */
export function getAndroidThemeBridge(): AndroidThemeBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as Window).AndroidThemeBridge;
  return bridge ?? null;
}

export default getAndroidThemeBridge;
