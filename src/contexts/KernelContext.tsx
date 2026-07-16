import React, { createContext, useContext, ReactNode } from "react";
import { IKernel, globalKernel } from "../kernel";

// 1. 创建 Context，以当前的 globalKernel 作为默认值，确保向下兼容与未修改处的健壮性
export const KernelContext = createContext<IKernel>(globalKernel);

// 2. 导出 Provider
export interface KernelProviderProps {
  kernel?: IKernel;
  children: ReactNode;
}

export const KernelProvider: React.FC<KernelProviderProps> = ({
  kernel = globalKernel,
  children,
}) => {
  return (
    <KernelContext.Provider value={kernel}>
      {children}
    </KernelContext.Provider>
  );
};

// 3. 导出 Hook
export const useKernel = (): IKernel => useContext(KernelContext);
