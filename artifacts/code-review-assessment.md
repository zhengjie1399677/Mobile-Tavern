# Mobile Tavern 代码审查体系评估报告

> 评估日期：2026-08-25
> 评估范围：代码审查标准、自动化门禁、CI 配置、git hooks、PR 流程、架构守卫
> 评估角色：Code Review Expert

---

## 一、结论先行

项目已具备**远超同类个人开源项目平均水平**的代码审查基础设施——10 节审查标准文档、750+ 行架构边界测试断言、智能 pre-push 门禁、完善的 PR 模板和稳定标识规则体系。

"代码质量参差不齐"的根因**不在标准缺失，而在自动化执行链路有断点**：CI 未运行 ESLint、无分支保护强制审查、pre-commit 只做类型检查不做 lint。这意味着绕过 pre-push hook（`--no-verify` 或未安装 hooks）的代码可以直接进入 main 而不被 ESLint 和人工审查拦截。

**改进核心策略**：不重写已有标准（已足够完善），而是补齐自动化执行链路的断点，让标准从"文档里写了"变成"CI 会拦"。

---

## 二、现状盘点

### 已建成的强项

| 编号 | 设施 | 文件位置 | 评价 |
|---|---|---|---|
| S1 | 审查标准文档 | `docs/agents/code_review.md` | 10 节完整覆盖：原则、分级、清单、专项、自动化分工、流程、规模分级、意见格式、职责、复盘 |
| S2 | 架构边界测试 | `tests/suites/architectureBoundaries.test.ts` | 750+ 行断言，守卫 Kernel 白名单、层间依赖方向、SillyTavern 隔离、Runtime Plugin 边界等 20+ 条铁律 |
| S3 | SSRF 安全测试 | `tests/suites/security.test.ts` | 覆盖 IPv4-mapped、八进制、十六进制、十进制等绕过向量 |
| S4 | 智能 pre-push 门禁 | `.githooks/pre-push` + `scripts/pre-push-quality.cjs` | 能识别纯版本发布提交，自动选择轻量校验或完整门禁 |
| S5 | 改动文件 ESLint 严格门禁 | `scripts/lint-changed.cjs` | 只检查 git diff 范围内的 TS/TSX，`--quiet` 阻断 error，历史 warning 放行 |
| S6 | PR 模板 | `.github/PULL_REQUEST_TEMPLATE.md` | 含改动范围勾选、自测记录、架构影响声明、审查提示 |
| S7 | 稳定标识规则体系 | `AGENTS.md` | 10 个稳定标识（`ARCH-KERNEL` 等），避免编号失效；架构测试自动校验标识存在 |
| S8 | ESLint flat config | `eslint.config.js` | 设计深思熟虑：历史债务 warning 呈现、正确性规则 error、React Hooks 规则合理降级 |
| S9 | 测试选择矩阵 | `docs/agents/development_workflow.md` | 按改动范围给出最低验证要求 |
| S10 | CI Quality Gate | `.github/workflows/quality.yml` | tsc + test + build + Playwright E2E 四道关卡 |

### 识别出的缺口

| 编号 | 缺口 | 严重度 | 影响 |
|---|---|---|---|
| G1 | **CI 未运行 ESLint** | 🔴 P0 | `quality.yml` 只跑 `npm run lint`（tsc --noEmit），不跑 `lint-changed.cjs`。跳过 pre-push hook 的代码不被 ESLint 拦截 |
| G2 | **无分支保护/强制审查** | 🔴 P0 | 无 CODEOWNERS、无 required review、无 direct push 限制。任何人可直接 push 到 main |
| G3 | **pre-commit 缺 ESLint** | 🟡 P1 | pre-commit 只跑 tsc，类型正确但 ESLint 可抓的问题（`no-debugger`、`eqeqeq`、未使用变量）要到 push 时才暴露 |
| G4 | **CONTRIBUTING.md 过期** | 🟡 P1 | 仍使用"准则一~十一"数字编号，与 AGENTS.md 2.0 的稳定标识体系冲突，贡献者读到过时信息 |
| G5 | **无依赖漏洞扫描** | 🟡 P1 | 无 Dependabot、无 `npm audit` 在 CI 中的集成 |
| G6 | **无 AI 自动审查** | 💭 P2 | 个人项目缺第二双眼睛，可引入 GitHub Copilot Review 或类似自动化审查 |
| G7 | **无 conventional commit 强制** | 💭 P2 | PR 模板建议语义化前缀但无自动化校验 |
| G8 | **无覆盖率追踪** | 💭 P2 | 审查标准要求测试但无覆盖率报告和阈值 |

---

## 三、改进方案（按优先级排序）

### P0：补齐 CI 执行断点（立即修复）

#### P0-1：CI Quality Gate 增加 ESLint 步骤

**问题**：`quality.yml` 的 `npm run lint` 实际是 `tsc --noEmit`，ESLint 从未在 CI 中执行。`lint-changed.cjs` 只在 pre-push hook 中调用。

**方案**：在 CI 中增加一步，对 PR 改动文件运行 ESLint 严格门禁。

修改 `.github/workflows/quality.yml`，在"类型检查"步骤后增加：

```yaml
      - name: 改动文件 ESLint 严格门禁
        run: node scripts/lint-changed.cjs origin/main
```

**理由**：`lint-changed.cjs` 已设计为接受基准分支参数（`origin/main`），正好适配 CI 场景。pre-push hook 使用 `HEAD` 基准检查工作区未提交改动，CI 使用 `origin/main` 检查 PR 差异——同一脚本两处复用。

#### P0-2：启用 GitHub 分支保护

**问题**：无分支保护规则，可直接 push 到 main 或跳过审查合入。

**方案**：在 GitHub 仓库 Settings → Branches → Branch protection rules 中为 `main` 配置：

- [x] Require a pull request before merging
  - [x] Require approvals: 1（个人项目可设为 0，但强制 PR 流程）
- [x] Require status checks to pass before merging
  - [x] Require branches to be up to date before merging
  - [x] 选择 `quality` 作业为必需状态检查
- [x] Require conversation resolution before merging
- [x] Do not allow bypassing the above settings

> **个人项目特殊说明**：approval 数可设为 0（无其他贡献者），但 PR 流程和 CI 状态检查必须强制。这意味着自己也要走 PR 流程合入 main，不能直接 push。

如果使用 GitHub CLI：

```bash
gh api repos/zhengjie1399677/Mobile-Tavern/branches/main/protection \
  -X PUT \
  -f required_pull_request_reviews[required_approving_review_count]=0 \
  -f required_status_checks[strict]=true \
  -f required_status_checks[contexts[]=quality \
  -f enforce_admins=true \
  -f restrictions=
```

---

### P1：强化本地与文档一致性

#### P1-1：pre-commit 增加 ESLint 快速检查

**问题**：pre-commit 只跑 `tsc --noEmit`，ESLint 可抓的正确性问题（`no-debugger`、`eqeqeq` 违规等）要到 push 时才暴露，反馈延迟大。

**方案**：修改 `.githooks/pre-commit`，增加对已暂存文件的 ESLint 检查：

```sh
#!/bin/sh
set -e

echo "Running pre-commit type check..."
npm run lint

echo "Running pre-commit ESLint on staged files..."
# 只检查已暂存的 TS/TSX 文件
staged_files=$(git diff --cached --name-only --diff-filter=ACMR | grep -E '\.(ts|tsx)$' || true)
if [ -n "$staged_files" ]; then
  npx eslint $staged_files --quiet
fi
```

**理由**：`--quiet` 只阻断 error（与 `lint-changed.cjs` 一致），warning 放行，不因历史债务卡住日常提交。pre-commit 检查的是暂存文件，比 pre-push 的 diff 范围更小，速度快。

#### P1-2：更新 CONTRIBUTING.md 对齐 AGENTS.md 2.0

**问题**：CONTRIBUTING.md 仍使用"准则一~十一"数字编号和旧描述，与 AGENTS.md 2.0 的稳定标识体系（`ARCH-KERNEL` 等）完全脱节。新贡献者读到的是过期信息。

**方案**：重写 CONTRIBUTING.md 的"行为指导手册"一节，改为引用稳定标识，并删除过时的准则列表。示例：

```markdown
## 行为指导手册

**所有贡献者必须首先阅读 [AGENTS.md](AGENTS.md)**。
该文件使用稳定标识（如 `ARCH-KERNEL`、`ARCH-FLOW`、`QUALITY-TYPES`）定义核心铁律，
涵盖：Kernel 边界、业务流程分层、兼容底座、移动端隔离、配置分轨、类型纪律、
变更安全、测试受控、文档规范与协作身份。

代码审查标准与流程见 `docs/agents/code_review.md`。
```

同时删除"准则一~十一"的详细列表，改为指向 AGENTS.md。

#### P1-3：引入 Dependabot 依赖漏洞扫描

**问题**：无自动化依赖漏洞扫描，`package-lock.json` 中的依赖可能引入已知漏洞而不自知。

**方案**：创建 `.github/dependabot.yml`：

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5
    labels:
      - "dependencies"
      - "chore"
    commit-message:
      prefix: "chore(deps)"
```

**理由**：每周扫描一次，自动开 PR 升级有漏洞的依赖。限制 5 个并发 PR 避免淹没。使用 `chore(deps)` 前缀符合项目的语义化提交规范。

---

### P2：增强自动化审查能力

#### P2-1：引入 GitHub Copilot Pull Request Review（可选）

**问题**：个人项目无第二位审查人，AI 审查是唯一可行的"第二双眼睛"。

**方案**：在 GitHub 仓库 Settings → General → Pull Requests 中启用 Copilot review，或在 PR 中手动 `@copilot review` 触发。

**适用性**：需要 GitHub Copilot 订阅。如果暂不引入，可用 code-review-expert 在本地 PR 前做一轮 AI 审查替代。

#### P2-2：增加 conventional commit 自动校验（可选）

**问题**：PR 标题建议语义化前缀但无自动化校验，容易遗漏。

**方案**：在 `quality.yml` 增加一步校验 PR 标题格式：

```yaml
      - name: 校验 PR 标题格式
        if: github.event_name == 'pull_request'
        run: |
          title="${{ github.event.pull_request.title }}"
          pattern="^(feat|fix|refactor|docs|test|chore|ci|build|perf)(\(.+\))?: .+"
          if ! echo "$title" | grep -qE "$pattern"; then
            echo "PR 标题不符合语义化提交格式：$title"
            echo "期望格式：type(scope?): description"
            exit 1
          fi
```

---

## 四、审查标准增强建议

现有 `docs/agents/code_review.md` 已经很完善，以下为小幅增强建议，不改变文档结构：

### 1. 增加第三节"通用审查清单"中的安全项

在"安全"小节补充：

```markdown
- [ ] 密钥与令牌不在客户端代码中硬编码；不在 console.log / 错误日志中泄漏。
- [ ] 第三方脚本/iframe 的 CSP 策略是否到位（SillyTavern 兼容场景尤其注意）。
- [ ] 文件上传/导入是否有类型与大小限制（角色卡 JSON、预设导入）。
```

**理由**：当前安全清单偏重注入和 SSRF，缺少密钥泄漏、CSP 和文件导入校验——这三项在角色卡/预设导入场景中风险较高。

### 2. 增加第四节"项目专项"中的 AI 编码审查项

在专项清单表后增加：

```markdown
### AI 编码工具审查补充

使用 AI 编码工具（codex/ 分支）产生的 PR，审查人额外关注：

- [ ] 幻觉引入：AI 生成的函数名、类型名、包名是否真实存在（常见于交叉引用不存在的导出）。
- [ ] 过度删除：AI 可能"清理"它不理解但实际必要的代码（架构守卫、边界校验等）。
- [ ] 测试幻觉：AI 声称"已添加测试"但测试实际未覆盖变更行为，或断言恒为 true。
- [ ] 范围漂移：AI 可能在修一个 bug 时顺手重构无关代码，违反"不借机扩大修改范围"（`CHANGE-SAFE`）。
```

**理由**：项目开发工作流明确包含 AI 编码工具（AGENTS.md 提到 `codex/` 前缀分支），AI 产生的代码有特定的反模式需要在审查中针对性拦截。

### 3. 第五节"自动化门禁"表格更新

当前表格列出了自动化层级，但未反映 CI 缺少 ESLint 的实际状态。修复 P0-1 后需同步更新此表：

```markdown
| CI | `.github/workflows/quality.yml` | `lint`(tsc) + **ESLint(lint-changed)** + `test` + `build` + Playwright E2E | 每次 PR 到 `main` |
```

---

## 五、实施路线图

| 阶段 | 任务 | 预期效果 | 依赖 |
|---|---|---|---|
| 第 1 步 | 修改 `quality.yml` 增加 ESLint 步骤 | CI 拦截 ESLint error | 无 |
| 第 2 步 | 启用 GitHub 分支保护 | 强制 PR 流程、CI 必须绿 | 第 1 步完成 |
| 第 3 步 | 修改 `.githooks/pre-commit` 增加 ESLint | 提交时即暴露正确性问题 | 无 |
| 第 4 步 | 更新 CONTRIBUTING.md | 贡献者读到准确信息 | 无 |
| 第 5 步 | 创建 `.github/dependabot.yml` | 依赖漏洞自动追踪 | 无 |
| 第 6 步 | 更新 `code_review.md` 增强 | 安全与 AI 审查项补全 | 无 |
| 第 7 步 | 引入 Copilot Review（可选） | 自动第二双眼睛 | Copilot 订阅 |

---

## 六、不需要改动的部分

以下设施经评估设计质量高、运行有效，**不建议改动**：

1. **`eslint.config.js` 的分层策略**：历史债务 warning 呈现 + 改动文件 error 阻断 + 正确性规则 error 的三层设计非常合理，适配渐进式债务清理的现实。
2. **`lint-changed.cjs` 的设计**：接受基准分支参数、只检查 TS/TSX、`--quiet` 过滤 warning——设计简洁且适配 CI 和 hook 双场景。
3. **`pre-push-quality.cjs` 的版本发布识别逻辑**：精确校验提交内容与 bump-version.cjs 生成结果一致才放行轻量门禁，任何不确定都回退到完整门禁——安全冗余设计正确。
4. **架构边界测试的断言粒度**：虽然 750+ 行字符串匹配看似脆弱，但每条断言都对应一条具体的架构铁律，是有意为之的"防回归"守卫，不应为"减少脆弱性"而放松。
5. **PR 模板的勾选清单**：自测记录 + 架构影响 + 审查提示三段式结构完整，无需增加字段。
6. **`code_review.md` 的整体结构与内容**：10 节覆盖全面，意见分级标准清晰，流程定义完整。只需按第四节建议小幅增强。

---

## 七、总结

Mobile Tavern 的代码审查体系在**标准和文档层面**已经非常成熟，问题出在**自动化执行链路**的两处关键断点：

1. CI 不运行 ESLint → 跳过 hook 的代码不受 ESLint 审查
2. 无分支保护 → 可以跳过 PR 审查流程直接 push main

修复 P0 两项即可显著提升代码质量的下限。P1 的 pre-commit ESLint 和 CONTRIBUTING.md 更新是短期改进。P2 的 AI 审查和 commit 格式校验是锦上添花。

**最重要的认知**：这个项目不需要更多标准——它需要让已有的标准在 CI 中自动执行，让标准从"文档说了"变成"CI 会拦"。
