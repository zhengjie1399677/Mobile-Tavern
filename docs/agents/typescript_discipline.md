# TypeScript 类型纪律

> 本文是 `AGENTS.md` 中 `QUALITY-TYPES` 的按需细则。只有任务涉及 TypeScript 类型设计、
> 显式 `any` 或下列历史文件时才需要读取。

## 一、默认禁止范围

新增或修改代码中禁止使用以下形式，除非属于本文豁免清单或经用户明确授权：

- `: any`、`<T = any>`、`Array<any>`、`Promise<any>`、`Record<string, any>`、`as any`
- `catch (error: any)`
- 返回值为 `any` 或包含 `any` 的联合类型

测试代码允许在 Mock 边界保留必要的动态断言，但应优先使用 `as unknown as T`。

## 二、优先替代方案

- 无法预知的外部数据使用 `unknown`，在消费处完成窄化。
- 请求、响应、导入文件和动态配置优先使用 Zod Schema，并通过 `z.infer` 推导类型。
- 多种返回形态使用联合类型或可辨识联合。
- 异质事件载荷使用泛型，例如 `IMessage<TPayload = unknown>`。
- 第三方库缺少类型时，使用局部声明；确实无法表达时使用带原因的 `@ts-expect-error`，不得扩散 `any`。
- `catch` 使用 `unknown`，通过 `instanceof Error` 或类型谓词读取错误信息。

## 三、历史豁免清单

下列 `any` 是渐进清理对象，不是新增代码模板：

| 文件 | 字段或位置 | 暂时豁免原因 |
|---|---|---|
| `src/utils/tavernHelper/bridgeCore.ts` | `initializeMvuFromCharacter` 等桥接参数 | 外部 SillyTavern 动态 JSON，已在防腐层收口 |
| `src/application/services/LLMService.ts` | `AbortSignal.any`、请求体与历史消息 | 平台类型和供应商请求结构尚未统一 |
| `src/application/services/TelemetryService.ts` | 稀疏遥测载荷 | 遥测契约仍在演进 |
| `src/application/services/{Tts,Asr,ImageGeneration}Service.ts` | Web API 与请求体 | Web Speech、FormData 等平台类型不完整 |
| `src/application/services/memory/` | LLM 抽取与召回中间结构 | 外部生成结构尚未完全 Schema 化 |
| `src/application/services/prompt/` | MVU 变量与模型能力 | 外部动态结构尚未完全 Schema 化 |
| `src/application/services/AutoSummaryService.ts` | 旧响应与记忆结构 | 已废弃，等待物理删除 |
| `src/types.ts` | 角色卡扩展、变量、消息附加字段 | SillyTavern 兼容动态 JSON |
| `src/components/FormattedText.tsx` | iframe、角色与正则脚本动态结构 | 等待富文本视图拆分和 Schema 收口 |
| `src/infrastructure/storage/` | 动态记录和 metadata | 存储 Schema 尚在渐进强类型化 |
| `src/infrastructure/storage/repositories/settingsRepository.ts` | 大型 Prompt 分段 | Preset 契约尚未稳定 |
| `src/hooks/settings/useBackupRestore.ts` | 备份导入时 `validatedCharacters`/`validatedSessions`/`rawMessages` 等清洗后子集 | 字段为 ChatSession/CharacterCard 的运行时子集，强类型化会丢字段或破坏 JSON 导入兼容；边界已通过 `typeof` 守卫收口 |

### 文件行数豁免（QUALITY-TYPES 单文件 1000 行阈值）

| 文件 | 当前行数 | 豁免原因 |
|---|---|---|
| `src/utils/tavernHelper/scriptIframe.ts` | ~1252 | SillyTavern 兼容端口 iframe 沙盒 HTML 工厂；已拆出 esmReplacer/scriptPreprocessor，剩余逻辑强耦合于沙盒生成与字符串模板，待兼容契约稳定后继续拆分 |
| `src/infrastructure/storage/indexedDbMemoryStore.ts` | ~991 | 已拆分至阈值以下，保留监控以防回涨 |

## 四、落地纪律

1. 触及含 `any` 的文件时，清理本次变更可触及的字段，但不要借机扩大无关重构。
2. 新增豁免前必须说明无法使用 `unknown`、Schema 或泛型的原因，并取得用户明确授权。
3. 经批准的豁免必须同步更新本表、代码注释和相关测试。
4. `@typescript-eslint/no-explicit-any` 保持为警告，用于呈现历史债务；架构审查负责阻止新增未登记豁免。
