import type { IKernel } from "../serviceContracts";
import { coreServiceCatalog, registerServiceModules } from "./serviceCatalog";

/** 动态装载并注册运行内核所需的官方服务；不包含 UI 或 React 依赖。 */
export async function registerCoreServices(kernel: IKernel): Promise<void> {
  await registerServiceModules(kernel, coreServiceCatalog);
}
