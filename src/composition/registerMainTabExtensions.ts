import { lazy } from "react";
import type { IKernel } from "../kernel/types";

// 主 Tab 均为独立业务域。仅在用户首次进入时下载，避免低频设置、世界书和调试沙盒阻塞首屏。
const CharactersTab = lazy(() => import("../tabs/CharactersTab"));
const ChatHistoryTab = lazy(() => import("../tabs/ChatHistoryTab"));
const ChatTab = lazy(() => import("../tabs/ChatTab"));
const GlobalWorldbookTab = lazy(() => import("../tabs/GlobalWorldbookTab"));
const SettingsTab = lazy(() => import("../tabs/SettingsTab"));
const PlaygroundTab = lazy(() => import("../tabs/PlaygroundTab"));

/** 应用层组合根：将 React 页面注册到主界面 Tab 扩展点。 */
export function registerMainTabExtensions(kernel: IKernel): void {
  kernel.registerExtension({ id: "characters", targetPoint: "main:tabs", priority: 100, component: CharactersTab, meta: { name: "角色", icon: "VenetianMask", showInBottomBar: true } });
  kernel.registerExtension({ id: "chat-history", targetPoint: "main:tabs", priority: 90, component: ChatHistoryTab, meta: { name: "历史对话", icon: "MessageSquare", showInBottomBar: true, highlightOnActiveTabs: ["chat-history", "chat"] } });
  kernel.registerExtension({ id: "chat", targetPoint: "main:tabs", priority: 80, component: ChatTab, meta: { name: "对话", showInBottomBar: false } });
  kernel.registerExtension({ id: "global-worldbook", targetPoint: "main:tabs", priority: 70, component: GlobalWorldbookTab, meta: { name: "世界书", icon: "Book", showInBottomBar: true } });
  kernel.registerExtension({ id: "settings", targetPoint: "main:tabs", priority: 60, component: SettingsTab, meta: { name: "设置", icon: "Settings", showInBottomBar: true } });
  kernel.registerExtension({ id: "playground", targetPoint: "main:tabs", priority: 50, component: PlaygroundTab, meta: { name: "沙盒", showInBottomBar: false } });
}
