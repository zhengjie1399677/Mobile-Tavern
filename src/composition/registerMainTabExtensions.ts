import { lazy } from "react";
import {
  KernelServices,
  type EffectDisposer,
  type IKernel,
  type ISettingsService,
} from "@/src/application/serviceContracts";
import type { UserSettings } from "../types";
import type { UsageMetrics } from "../domain/usage/metrics";
import { shouldShowCommunityEntry } from "../domain/community/entryGate";
import { loadChatTab } from "./mainTabLoaders";

// 主 Tab 均为独立业务域。仅在用户首次进入时下载，避免低频设置、世界书和调试沙盒阻塞首屏。
const CharactersTab = lazy(() => import("../tabs/CharactersTab"));
const CommunityTab = lazy(() => import("../tabs/CommunityTab"));
const ChatHistoryTab = lazy(() => import("../tabs/ChatHistoryTab"));
const ChatTab = lazy(loadChatTab);
const GlobalWorldbookTab = lazy(() => import("../tabs/GlobalWorldbookTab"));
const SettingsTab = lazy(() => import("../tabs/SettingsTab"));
const PlaygroundTab = lazy(() => import("../tabs/PlaygroundTab"));

/** 应用层组合根：将 React 页面注册到主界面 Tab 扩展点。 */
export async function registerMainTabExtensions(kernel: IKernel): Promise<EffectDisposer> {
  const disposers: EffectDisposer[] = [];
  const register = (extension: Parameters<IKernel["registerExtension"]>[0]): void => {
    disposers.push(kernel.registerExtension(extension));
  };
  const disposeAll = async (): Promise<void> => {
    const errors: unknown[] = [];
    for (let index = disposers.length - 1; index >= 0; index--) {
      try {
        await disposers[index]();
      } catch (error: unknown) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, "MAIN_TAB_EXTENSIONS_DISPOSE_FAILED");
  };

  try {
    register({ id: "characters", targetPoint: "main:tabs", priority: 100, value: CharactersTab, meta: { name: "角色", icon: "VenetianMask", showInBottomBar: true } });
    const settingsService = kernel.getService<ISettingsService<UserSettings, UsageMetrics>>(
      KernelServices.Settings,
    );
    if (await shouldShowCommunityEntry(settingsService)) {
      register({ id: "community", targetPoint: "main:tabs", priority: 95, value: CommunityTab, meta: { name: "社区", icon: "Users", showInBottomBar: true } });
    }
    register({ id: "chat-history", targetPoint: "main:tabs", priority: 90, value: ChatHistoryTab, meta: { name: "历史对话", icon: "MessageSquare", showInBottomBar: true, highlightOnActiveTabs: ["chat-history", "chat"] } });
    register({ id: "chat", targetPoint: "main:tabs", priority: 80, value: ChatTab, meta: { name: "对话", showInBottomBar: false } });
    register({ id: "global-worldbook", targetPoint: "main:tabs", priority: 70, value: GlobalWorldbookTab, meta: { name: "世界书", icon: "Book", showInBottomBar: true } });
    register({ id: "settings", targetPoint: "main:tabs", priority: 60, value: SettingsTab, meta: { name: "设置", icon: "Settings", showInBottomBar: true } });
    register({ id: "playground", targetPoint: "main:tabs", priority: 50, value: PlaygroundTab, meta: { name: "沙盒", showInBottomBar: false } });
  } catch (error: unknown) {
    try {
      await disposeAll();
    } catch (cleanupError: unknown) {
      throw new AggregateError([error, cleanupError], "MAIN_TAB_EXTENSIONS_REGISTER_FAILED");
    }
    throw error;
  }

  let active = true;
  return async () => {
    if (!active) return;
    active = false;
    await disposeAll();
  };
}
