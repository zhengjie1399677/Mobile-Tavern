import type { UnifiedAppContextProps } from "../../../../UnifiedAppContext";
import type { ViewportSize } from "../../utils";

export interface AndroidThemeBridge {
    getSafeAreas?: () => string;
    setStatusBarStyle?: (isDark: boolean, color: string) => void;
    saveFile?: (fileName: string, content: string) => string;
    saveFileBase64?: (fileName: string, base64Data: string, mimeType: string) => string;
    verifyFileIo?: () => string;
    openUrl?: (url: string) => void;
    speakNative?: (text: string) => void;
    stopNative?: () => void;
    isSpeakingNative?: () => boolean;
    getActiveInputMethod?: () => string;
    [key: string]: unknown;
}

export interface WindowWithAndroidBridge extends Window {
    AndroidThemeBridge?: AndroidThemeBridge;
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
}

export interface NetworkInformationLike {
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
}

export interface NavigatorWithConnection extends Navigator {
    connection?: NetworkInformationLike;
    mozConnection?: NetworkInformationLike;
    webkitConnection?: NetworkInformationLike;
}

export interface PerformanceMemoryLike {
    jsHeapSizeLimit: number;
    totalJSHeapSize: number;
    usedJSHeapSize: number;
}

export interface NavigatorWithMemory extends Navigator {
    deviceMemory?: number;
}

export interface PerformanceWithMemory extends Performance {
    memory?: PerformanceMemoryLike;
}

export interface SystemReportSectionProps
    extends Pick<
        UnifiedAppContextProps,
        | "settings"
        | "safeAreas"
        | "showCustomAlert"
        | "getKernelService"
    > {
    isTauri: boolean;
    deviceModel: string;
    viewportSize: ViewportSize;
}

export interface DiagnosticSection {
    id: string;
    title: string;
    lines: string[];
    hasError: boolean;
    hasWarning: boolean;
}
