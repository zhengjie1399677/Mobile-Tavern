# SillyTavern Compatibility Runtime

本目录是 SillyTavern 外部生态兼容运行时的权威入口，负责角色卡扩展、MVU、正则脚本、iframe 注入和兼容降级。

它不属于 Kernel，也不属于通用应用 Service 体系；应用服务只能把它当作外部格式防腐运行时调用。`src/utils/tavernHelper/` 暂时保留底层实现和旧导入兼容，新增生产代码必须从本目录导入，待旧路径调用清零后再物理迁移实现。
