// 纯函数工具与文件级全局可变状态
// 从原 ChatTab.tsx 中抽离，供子模块共享

export const isSafeRegex = (pattern: string): boolean => {
  if (!pattern) return true;
  return !/(\([^\)]*[\+\*]\)[^\)]*[\+\*])/.test(pattern) && !/(\[[^\]]*[\+\*]\][^\]]*[\+\*])/.test(pattern);
};

// 文件级全局可变状态容器，抗御任何组件的销毁重装，确保基准永不丢失
// 使用对象封装以便跨模块读写（ES Module 的 let 导出无法被外部赋值）
export const chatTabState = {
  // 建议词点击模式：send=直接发送 / fill=填入框内
  suggestionsClickMode: null as "send" | "fill" | null,
  // 全局基准高度（用于键盘检测阈值计算）
  maxHeight: window.innerHeight,
};
