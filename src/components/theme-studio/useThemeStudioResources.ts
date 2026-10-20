import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalResourceMetadata } from "../../domain/resources/types";
import type { ThemeStudioResourcePort } from "./themeStudioResourcePort";

export interface ThemeStudioResourcesState {
  resources: LocalResourceMetadata[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  importResource: (file: File) => Promise<LocalResourceMetadata>;
}

/** 只暴露音视频资源；图片不参与 Theme 1.1 的媒体定义。 */
function selectMediaResources(resources: LocalResourceMetadata[]): LocalResourceMetadata[] {
  return resources.filter(resource => resource.kind === "audio" || resource.kind === "video");
}

export function useThemeStudioResources(
  port: ThemeStudioResourcePort | undefined,
): ThemeStudioResourcesState {
  const [resources, setResources] = useState<LocalResourceMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!port) {
      setResources([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const list = await port.listResources();
      if (mountedRef.current) setResources(selectMediaResources(list));
    } catch (loadError: unknown) {
      if (mountedRef.current) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [port]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const importResource = useCallback(async (file: File): Promise<LocalResourceMetadata> => {
    if (!port) throw new Error("resource-port-unavailable");
    const metadata = await port.importFile(file);
    await refresh();
    return metadata;
  }, [port, refresh]);

  return { resources, isLoading, error, refresh, importResource };
}
