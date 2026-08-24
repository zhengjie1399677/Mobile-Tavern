import React, { createContext, useContext, type ReactNode } from "react";
import type { IKernel } from "../kernel";

export const KernelContext = createContext<IKernel | null>(null);

export interface KernelProviderProps {
  kernel: IKernel;
  children: ReactNode;
}

export const KernelProvider: React.FC<KernelProviderProps> = ({
  kernel,
  children,
}) => (
  <KernelContext.Provider value={kernel}>{children}</KernelContext.Provider>
);

export const useKernel = (): IKernel => {
  const kernel = useContext(KernelContext);
  if (!kernel) {
    throw new Error("useKernel 必须在 KernelProvider 内调用");
  }
  return kernel;
};

/** 仅用于允许脱离应用组合根渲染的纯展示组件与隔离测试。 */
export const useOptionalKernel = (): IKernel | null => useContext(KernelContext);
