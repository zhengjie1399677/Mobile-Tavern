# 配置分轨与环境变量规范

## 一、目标

本项目统一的是配置的读取入口、类型校验、命名单位和秘密边界，而不是把所有常量集中到一个文件。配置必须按运行产物物理分轨，避免移动端、Node 开发服务和云端容器相互污染。

## 二、权威入口

| 配置轨道 | 权威入口 | 允许内容 | 禁止内容 |
|---|---|---|---|
| 移动端公开环境 | `src/config/publicEnvironment.ts` | `VITE_*` 公开地址、构建模式 | API Key、签名密钥、管理员令牌 |
| 功能发布策略 | `src/config/featurePolicies.ts` | 功能开关、灰度天数、累计使用时长 | 存储实现参数、用户设置、云端秘密 |
| Vite 构建环境 | `build/viteEnvironment.ts` | Tauri 平台判断、HMR 开关 | 业务功能策略、运行时秘密 |
| 本地 Node 服务 | `server/config.ts` | 端口、Host、本地代理地址和服务端秘密 | 移动端用户设置、云端容器配置 |
| 最小社区云端 | `cloud/minimal-community/src/config.rs` | 数据目录、CORS、上传限流、管理员令牌 | 移动端构建变量、Node 开发服务配置 |

## 三、依赖方向

```text
import.meta.env ─→ publicEnvironment ─→ featurePolicies ─→ 领域消费者
process.env     ─→ server/config      ─→ server.ts
process.env     ─→ viteEnvironment    ─→ vite.config.ts
容器环境变量    ─→ cloud 服务 Config  ─→ 对应云端服务
```

除权威入口外，生产代码不得直接读取环境变量。Kernel 为保持独立运行时能力，可在内部检测开发或生产模式，但不得读取业务变量。

当前社区发布策略支持以下公开构建变量：

| 变量 | 含义 | 默认行为 |
|---|---|---|
| `VITE_COMMUNITY_ORIGIN` | 社区服务公开地址 | `https://community.neural-node.xyz` |
| `VITE_COMMUNITY_ENABLED` | 是否显示社区入口 | 留空时开发开启、生产关闭 |
| `VITE_COMMUNITY_MIN_FIRST_USE_AGE_DAYS` | 首次使用后至少经过的天数 | `0` |
| `VITE_COMMUNITY_MIN_CUMULATIVE_USAGE_HOURS` | 累计使用至少达到的小时数 | `0` |

所有数值在构建初始化时校验为非负有限数，非法值会阻止构建，不允许静默退回默认值。

## 四、命名与单位

- 时间字段必须以 `Ms`、`Seconds`、`Minutes`、`Hours` 或 `Days` 结尾。
- 容量字段必须以 `Bytes` 结尾。
- 数量上限使用 `Max` 前缀或明确的 `Limit` 后缀。
- 地址字段使用 `Url` 或 `Origin` 后缀，进入配置层时完成合法 URL 校验和尾斜杠规范化。
- 布尔开关使用肯定语义，避免双重否定；兼容外部变量时可在配置层转换。

## 五、秘密规则

1. `VITE_*` 会被 Vite 注入客户端包，始终视为公开数据。
2. Node 服务在 `production` 模式下缺失 HMAC、AES 或试用 API Key 时必须启动失败。
3. 社区管理员令牌留空表示关闭删除接口；启用时至少为 32 个字符。
4. 示例文件不得包含可用秘密，日志不得输出解析后的秘密值。
5. 不允许以“方便本地运行”为理由让生产模式使用开发默认密钥。

## 六、新增配置流程

1. 判断配置属于哪个运行产物和哪条轨道。
2. 在所属权威入口的 Schema 或类型化 Config 中声明并校验。
3. 使用带单位的字段名向消费者暴露，不把原始字符串继续向下传递。
4. 更新对应 `.env.example`；移动端公开变量需特别确认不含秘密。
5. 添加正常值、非法值和生产缺失值测试。
6. 运行架构守卫，确认没有新增直接环境变量读取。
