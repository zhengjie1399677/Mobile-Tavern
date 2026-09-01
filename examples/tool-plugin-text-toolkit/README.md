# 文本工具箱 Tool Plugin 示例

这是使用仓库内 `sdk/tool-plugin/` 构建的官方最小示例，包含两个一次性 Worker Tool：

- `text.stats`：统计 Unicode 字符、非空单词和行数；
- `text.normalize-whitespace`：统一换行、清除行尾空白并压缩连续空行。

示例不申请权限、不访问网络、不写入数据，也不会自动安装或启用。它用于说明 Manifest、类型化 handler、Worker 注册和确定性 `.mttool` 打包的完整链路。

在仓库根目录运行：

```powershell
npm run build:example:tool-plugin
```

生成的 `text-toolkit.mttool` 可在 Tool Plugin 管理界面导入。导入后仍需由用户显式启用；自定义 Agent 还需要在其 Tool 挂载列表中选择对应工具。
