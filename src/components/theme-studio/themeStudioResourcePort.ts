/**
 * 主题工作室访问本地资源的最小端口。
 *
 * 组件只依赖这个接口，由 `ThemeConfigSection` 用应用层 `ILocalResourceService`
 * 适配；媒体定义只保存 `tavern-resource://r_...` 引用，不把元数据写进主题包。
 */

import type { ILocalResourceService } from "../../application/serviceContracts";
import type { LocalResourceMetadata } from "../../domain/resources/types";

export interface ThemeStudioResourcePort {
  listResources(): Promise<LocalResourceMetadata[]>;
  importFile(file: File): Promise<LocalResourceMetadata>;
  getObjectUrl(id: string): Promise<string>;
  getResourceReference(id: string): string;
}

export function createThemeStudioResourcePort(
  service: ILocalResourceService,
): ThemeStudioResourcePort {
  return {
    listResources: () => service.listResources(),
    importFile: file => service.importFile(file),
    getObjectUrl: id => service.getObjectUrl(id),
    getResourceReference: id => service.getResourceReference(id),
  };
}
