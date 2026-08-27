/** 聊天主页面的共享动态加载入口，供 React.lazy 与交互预取复用同一模块缓存。 */
export const loadChatTab = () => import("../tabs/ChatTab");

/** 在角色与会话数据准备期间并行解析聊天页分块，避免首次进入等待串行化。 */
export async function preloadChatTab(): Promise<void> {
  await loadChatTab();
}
