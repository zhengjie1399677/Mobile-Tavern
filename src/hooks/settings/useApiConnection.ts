import type * as React from "react";
import { useCallback } from "react";
import { UserSettings } from "../../types";
import { universalFetch } from "../../utils/apiClient";

interface UseApiConnectionDeps {
  settings: UserSettings;
  updateSettings: (
    updater: UserSettings | ((prev: UserSettings) => UserSettings)
  ) => void;
  setAvailableModels: React.Dispatch<React.SetStateAction<string[]>>;
  setIsFetchingModels: React.Dispatch<React.SetStateAction<boolean>>;
  setConnectionStatus: React.Dispatch<React.SetStateAction<{
    testing: boolean;
    success?: boolean;
    message?: string;
  }>>;
}

interface UseApiConnectionReturn {
  handleFetchModels: () => Promise<void>;
  testApiConnection: () => Promise<void>;
}

/**
 * API 连接子 Hook。
 *
 * 负责：
 * - handleFetchModels：通过 universalFetch 拉取远端模型列表，并在当前模型缺失时自动选中首个
 * - testApiConnection：向远端发起一次测试连接请求以校验 API 凭证可用性
 */
export const useApiConnection = ({
  settings,
  updateSettings,
  setAvailableModels,
  setIsFetchingModels,
  setConnectionStatus,
}: UseApiConnectionDeps): UseApiConnectionReturn => {
  const handleFetchModels = useCallback(async () => {
    setIsFetchingModels(true);
    setConnectionStatus({ testing: true });
    try {
      const response = await universalFetch("/api/proxy/models", {
        type: settings.api.type,
        baseUrl: settings.api.baseUrl,
        apiKey: settings.api.apiKey,
        modelsPath: settings.api.modelsPath,
        bypassProxy: settings.api.bypassProxy,
        forceBasicParams: settings.api.forceBasicParams,
      });
      const data = await response.json();
      if (data.success && data.models) {
        const modelIds = data.models.map((m: any) => m.id);
        setAvailableModels(modelIds);
        setConnectionStatus({
          testing: false,
          success: true,
          message: "模型列表获取成功",
        });

        // Auto-select first model if current selection is empty or invalid
        if (modelIds.length > 0) {
          const currentModel = settings.api.modelName;
          if (!currentModel || !modelIds.includes(currentModel)) {
            updateSettings({
              ...settings,
              api: {
                ...settings.api,
                modelName: modelIds[0],
              },
            });
          }
        }
      } else {
        setConnectionStatus({
          testing: false,
          success: false,
          message: `获取失败: ${data.error}`,
        });
      }
    } catch (e: any) {
      setConnectionStatus({
        testing: false,
        success: false,
        message: `请求错误: ${e.message}`,
      });
    } finally {
      setIsFetchingModels(false);
    }
  }, [settings, updateSettings, setIsFetchingModels, setConnectionStatus, setAvailableModels]);

  const testApiConnection = useCallback(async () => {
    setConnectionStatus({ testing: true });
    try {
      const response = await universalFetch("/api/test-connection", {
        baseUrl: settings.api.baseUrl,
        apiKey: settings.api.apiKey,
        modelName: settings.api.modelName,
        chatPath: settings.api.chatPath,
        bypassProxy: settings.api.bypassProxy,
        forceBasicParams: settings.api.forceBasicParams,
      });
      const data = await response.json();
      if (data.success) {
        setConnectionStatus({
          testing: false,
          success: true,
          message: data.message || "连接成功！",
        });
      } else {
        setConnectionStatus({
          testing: false,
          success: false,
          message: `连接失败: ${data.error}`,
        });
      }
    } catch (e: any) {
      setConnectionStatus({
        testing: false,
        success: false,
        message: `请求错误: ${e.message}`,
      });
    }
  }, [settings.api, setConnectionStatus]);

  return { handleFetchModels, testApiConnection };
};
