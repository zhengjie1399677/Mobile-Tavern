# SillyTavern MVU 变量系统（变量卡）创建指南

本指南整合了变量结构（`schema.ts`）、初始变量（`initvar.yaml`）、更新规则（`变量更新规则.yaml`）的编写规范以及收尾注入与校验流程。您可以直接复制保存为本地参考。

---

## 一、 前置条件与目录结构

在开始前，请确保在项目状态文件 `tavern-cards-state.json` 中已启用 MVU：
```json
{
  "mvu": true
}
```

MVU 变量系统核心包含以下 3 个需要手动编写的文件：
```
{project}/
├── schema.ts                # 1. 变量结构定义 (TypeScript/Zod)
└── 世界书/
    └── 变量/
        ├── initvar.yaml     # 2. 初始变量值 ([InitVar]请勿打开)
        └── 变量更新规则.yaml # 3. 变量更新指示 ([mvu_update]变量更新规则)
```

---

## 二、 核心文件编写规范

### 1. 变量结构脚本 `schema.ts`

`schema.ts` 规定了变量的底层数据格式，运行时会被编译为 Zod 校验规则。

#### 核心规则：
* **变量特殊前缀**：
  * **无前缀**（如 `好感度`）：普通变量，AI 可读写。
  * **`_` 前缀**（如 `_派生状态`）：只读变量，仅脚本可修改，AI 可读但不可写。
  * **`$` 前缀**（如 `$私有标记`）：隐藏变量，AI 不可见，仅脚本可读写。
* **命名与类型**：
  * 变量名需语义自明，不使用繁体中文。**禁止在 Key 中使用 `{{user}}` 等运行时宏**。
  * 限制使用 `z.enum`（仅在控制显隐/EJS精确匹配时使用，其余均使用自由度更高的 `z.string()`）。
  * 数字类型一律使用 `z.coerce.number()`，数值限制使用 `_.clamp` 进行转换约束。
  * 不对根变量使用 `.optional()`。

#### `schema.ts` 模板示例：
```typescript
export const Schema = z.object({
  当前场景: z.string().default('空置'),
  主角: z.object({
    好感度: z.coerce.number().transform(v => _.clamp(v, 0, 100)).default(30),
    _依存度: z.coerce.number().transform(v => _.clamp(v, 0, 100)).default(0), // 只读
    状态描述: z.string().default('正常'),
  }),
  任务列表: z.record(
    z.string().describe('任务名'),
    z.object({
      类型: z.enum(['主线', '支线']),
      进度: z.enum(['进行中', '已完成']).default('进行中'),
    })
  ).default({}),
});

export type Schema = z.output<typeof Schema>;
```

---

### 2. 初始变量 `initvar.yaml`

`initvar.yaml` 定义变量在游戏开场时的初始值。

#### 核心规则：
* 数据结构必须与 `schema.ts` 的结构严格一致。
* 初始数值设定要契合开场白（First Message）的实际剧情状态。
* 必须保存为世界书条目 `[InitVar]请勿打开`。

#### `initvar.yaml` 模板示例：
```yaml
当前场景: "繁华的落日酒馆"
主角:
  好感度: 30
  _依存度: 0
  状态描述: "略显拘谨"
任务列表:
  寻找失落徽章:
    类型: "支线"
    进度: "进行中"
```

---

### 3. 变量更新规则 `变量更新规则.yaml`

该文件用于引导 AI 在对话推进时，按照设定逻辑更新变量。

#### 核心规则：
* **自明变量省略**：若变量更新方式显而易见（如`当前场景`或命名极为明确的变量），请勿编写 `check` 规则以节省 token。
* **合并同类项**：使用 `${键1|键2}` 语法合并规则相同或相似的子字段。
* **跳过只读/隐藏变量**：`_` 或 `$` 开头的变量**严禁**编写更新规则。
* 必须保存为世界书条目 `[mvu_update]变量更新规则`。

#### `变量更新规则.yaml` 模板示例：
```yaml
---
变量更新规则:
  当前场景:
    check:
      - 仅在主角明确发生位置移动或剧情跳转时更新为新场景名
  主角:
    好感度:
      type: number
      range: 0~100
      check:
        - 根据主角对<user>的态度和交互反馈进行调整，单次变动范围在 ±(1~5)
        - 发生显著冲突或正面事件时可调整 ±(5~10)
    状态描述:
      check:
        - 结合当前剧情发展、健康状况和心理状态实时更新
  任务列表:
    type: |-
      {
        [任务名: string]: {
          类型: '主线' | '支线';
          进度: '进行中' | '已完成';
        }
      }
    check:
      - 剧情中触发新目标时新增任务项
      - 达成任务条件后，将"进度"改为"已完成"
```

---

## 三、 收尾、注入与校验步骤

编写完上述 3 个核心文件后，请在项目根目录下依次执行以下 CLI 命令进行收尾：

### 1. 复制模板资产
将全局的 MVU 模板资产复制到当前项目目录下：
```bash
cp -r assets/mvu-templates/* ./
```

### 2. 内联 Schema 到运行脚本
将 `schema.ts` 的 Zod 内容写入 `脚本/Zod.txt` 中，替换 `// SCHEMA_CONTENT` 占位行，并移除 TypeScript 专属的 `export type` 声明：
```bash
# Windows PowerShell 中可手动编辑或运行替换命令
# Linux/macOS Shell 下的命令：
sed -i -e '/\/\/ SCHEMA_CONTENT/{r schema.ts' -e 'd}' -e '/^export type/d' 脚本/Zod.txt
```

### 3. 应用 JSON Patch 注入配置
根据项目类型运行对应的 patch 命令，将 MVU 规则和正则脚本注册到角色卡中。

* **新创建的项目**（从未注入过正则脚本）：
  ```bash
  node scripts/tavern-cards-forge.mjs patch {project} --file assets/mvu-prereq-patch.json
  node scripts/tavern-cards-forge.mjs patch {project} --file assets/mvu-patch.json
  ```
* **已有/已解包的项目**（已存在 extensions 结构）：
  ```bash
  node scripts/tavern-cards-forge.mjs patch {project} --file assets/mvu-patch.json
  ```

### 4. 运行一致性校验
在打包输出前，必须确保格式和逻辑无误：
```bash
# 校验 initvar.yaml 是否符合 schema.ts 定义
node scripts/tavern-cards-forge.mjs validate-mvu {project}
```

---

## 四、 MVU 变量一致性自查清单

在提交或打包项目前，请对照以下清单进行最终自查：

- [ ] **Schema 定义**：`schema.ts` 导出了 `Schema` 和 `Schema` 类型，且未使用 `.strict()` / `.passthrough()`。
- [ ] **特殊前缀**：带有 `_` 前缀的只读变量没有在 `变量更新规则.yaml` 中编写更新规则。
- [ ] **宏过滤**：变量的 Key（键名）中没有包含 `{{user}}` 等运行时宏。
- [ ] **一致性**：`initvar.yaml` 的初始值与开场白（First Message）的描述完全对应（例如开场白说在酒馆，则 `当前场景` 必须为酒馆）。
- [ ] **逻辑闭环**：`schema.ts` 中定义的 `enum` 枚举值（如场景、阶段、情绪状态），在世界书中均有对应的描述条目。
