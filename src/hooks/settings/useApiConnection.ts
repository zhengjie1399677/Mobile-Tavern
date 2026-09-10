import type * as React from "react";
import { useCallback } from "react";
import { UserSettings } from "../../types";
import { universalFetch } from "../../utils/apiClient";

import { getErrorMessage, getErrorName } from '../../utils/errorUtils';
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
 * 测试连接的上限等待时间。
 *
 * 测试连接会真实发起一次 chat completion（`ping`），因此耗时取决于模型与中转站；
 * 推理模型即使只生成 5 个 token 也可能思考很久，超过上限就明确报超时而不是无限转圈。
 */
const TEST_CONNECTION_TIMEOUT_MS = 25_000;

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
    } catch (e: unknown) {
      setConnectionStatus({
        testing: false,
        success: false,
        message: `请求错误: ${getErrorMessage(e)}`,
      });
    } finally {
      setIsFetchingModels(false);
    }
  }, [settings, updateSettings, setIsFetchingModels, setConnectionStatus, setAvailableModels]);

  const testApiConnection = useCallback(async () => {
    setConnectionStatus({ testing: true });
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), TEST_CONNECTION_TIMEOUT_MS);
    try {
      const response = await universalFetch(
        "/api/test-connection",
        {
          baseUrl: settings.api.baseUrl,
          apiKey: settings.api.apiKey,
          modelName: settings.api.modelName,
          chatPath: settings.api.chatPath,
          bypassProxy: settings.api.bypassProxy,
          forceBasicParams: settings.api.forceBasicParams,
          // ping 只验证连通性与凭据，不需要思维链；否则推理模型会为 5 个 token 跑完整推理。
          disableReasoning: true,
        },
        { customSignal: controller.signal },
      );
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
    } catch (e: unknown) {
      setConnectionStatus({
        testing: false,
        success: false,
        message: controller.signal.aborted
          ? `测试超时（${Math.round(TEST_CONNECTION_TIMEOUT_MS / 1000)} 秒）：模型或中转站响应过慢；推理模型可稍后重试。`
          : `请求错误: ${getErrorMessage(e)}`,
      });
    } finally {
      window.clearTimeout(timeoutId);
    }
  }, [settings.api, setConnectionStatus]);

  return { handleFetchModels, testApiConnection };
};
